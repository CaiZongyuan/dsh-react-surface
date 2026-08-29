import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type ReactSurfaceFramework = "next" | "vite";

export interface ScaffoldReactSurfaceOptions {
  projectDirectory: string;
  outputDirectory?: string;
  framework?: ReactSurfaceFramework;
  applicationEntry?: string;
  surfaceId?: string;
  title?: string;
  dryRun?: boolean;
}

export interface ScaffoldReactSurfaceResult {
  framework: ReactSurfaceFramework;
  outputDirectory: string;
  files: readonly string[];
}

interface ProjectManifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface PlannedFile {
  path: string;
  content: string;
}

/** Generate one isolated DSH Adapter without rewriting the application source. */
export async function scaffoldReactSurface({
  projectDirectory: projectDirectoryInput,
  outputDirectory: outputDirectoryInput,
  framework: requestedFramework,
  applicationEntry: applicationEntryInput,
  surfaceId: surfaceIdInput,
  title: titleInput,
  dryRun = false,
}: ScaffoldReactSurfaceOptions): Promise<ScaffoldReactSurfaceResult> {
  const projectDirectory = resolve(projectDirectoryInput);
  const manifestPath = join(projectDirectory, "package.json");
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as ProjectManifest;
  const framework = requestedFramework ?? detectFramework(manifest);
  const outputDirectory = resolve(
    projectDirectory,
    outputDirectoryInput ?? join("integrations", "dsh"),
  );
  assertInsideProject(projectDirectory, outputDirectory);

  const slug = packageSlug(manifest.name ?? "react-application");
  const title = titleInput?.trim() || displayName(slug);
  const surfaceId = surfaceIdInput ?? `app.${slug}`;
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(surfaceId)) {
    throw new TypeError(`Invalid Surface id: ${surfaceId}`);
  }

  const applicationEntry = applicationEntryInput
    ? resolve(projectDirectory, applicationEntryInput)
    : await detectApplicationEntry(projectDirectory, framework);
  if (applicationEntry) assertInsideProject(projectDirectory, applicationEntry);

  const repositoryRoot = resolve(import.meta.dir, "../../..");
  const runtimeDirectory = join(repositoryRoot, "packages", "runtime");
  const buildDirectory = join(repositoryRoot, "packages", "build");
  const planned = planFiles({
    outputDirectory,
    framework,
    applicationEntry,
    runtimeDirectory,
    buildDirectory,
    packageName: `${slug}-dsh-surface`,
    surfaceId,
    title,
  });

  await assertFilesAbsent(planned);
  if (!dryRun) {
    for (const file of planned) {
      await mkdir(dirname(file.path), { recursive: true });
      await writeFile(file.path, file.content, "utf8");
    }
  }
  return Object.freeze({
    framework,
    outputDirectory,
    files: Object.freeze(planned.map((file) => file.path)),
  });
}

function planFiles({
  outputDirectory,
  framework,
  applicationEntry,
  runtimeDirectory,
  buildDirectory,
  packageName,
  surfaceId,
  title,
}: {
  outputDirectory: string;
  framework: ReactSurfaceFramework;
  applicationEntry: string | undefined;
  runtimeDirectory: string;
  buildDirectory: string;
  packageName: string;
  surfaceId: string;
  title: string;
}): PlannedFile[] {
  const clientDirectory = join(outputDirectory, "src", "client");
  const runtimeDependency = fileDependency(outputDirectory, runtimeDirectory);
  const buildDependency = fileDependency(outputDirectory, buildDirectory);
  const manifest = {
    name: packageName,
    version: "0.0.0",
    private: true,
    type: "module",
    main: "./lib/index.js",
    files: ["lib", "cordis.patch.yml"],
    scripts: {
      build: "dsh-react-surface-build .",
    },
    dsh: {
      bundle: { patch: "./cordis.patch.yml" },
      reactSurface: { id: surfaceId, projectRoot: "../.." },
      client: {
        platform: "web",
        inject: ["dsh-react-surface"],
        external: ["dsh-react-surface/client"],
      },
    },
    peerDependencies: {
      "@deepseek-ai/cordis": "^4.0.1",
      "dsh-react-surface": "*",
      react: "^18.2.0 || ^19.0.0",
      "react-dom": "^18.2.0 || ^19.0.0",
    },
    devDependencies: {
      "dsh-react-surface": runtimeDependency,
      "dsh-react-surface-build": buildDependency,
    },
  };
  return [
    {
      path: join(outputDirectory, "package.json"),
      content: `${JSON.stringify(manifest, null, 2)}\n`,
    },
    {
      path: join(outputDirectory, "cordis.patch.yml"),
      content: `- insert:\n    - id: ${surfaceId.replaceAll(".", "-")}\n      name: ${packageName}\n`,
    },
    {
      path: join(outputDirectory, "src", "index.ts"),
      content:
        "/** Host entry for a browser-owned React Surface. */\nexport function apply(): void {}\n",
    },
    {
      path: join(clientDirectory, "index.tsx"),
      content: clientEntryTemplate(surfaceId, title),
    },
    {
      path: join(clientDirectory, "surface-root.tsx"),
      content: surfaceRootTemplate(
        framework,
        title,
        applicationEntry
          ? moduleSpecifier(clientDirectory, applicationEntry)
          : undefined,
      ),
    },
    {
      path: join(clientDirectory, "surface.css"),
      content: `.generated-surface {
  align-items: center;
  background: var(--dsh-surface-background);
  color: var(--dsh-surface-foreground);
  display: flex;
  height: 100%;
  justify-content: center;
}
`,
    },
  ];
}

function clientEntryTemplate(surfaceId: string, title: string): string {
  return `import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import { defineReactSurface } from "dsh-react-surface/client";

import { SurfaceRoot } from "./surface-root.tsx";

const definition = defineReactSurface({
  id: ${JSON.stringify(surfaceId)},
  title: ${JSON.stringify(title)},
  component: SurfaceRoot,
  layout: {
    default: "workspace",
    supported: ["full-frame", "center", "workspace", "right-panel", "bottom-panel"],
    fallback: "full-frame",
  },
  lifecycle: { mount: "lazy", retention: "keep-alive" },
});

export const inject = ["reactSurfaces"];

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.reactSurfaces.register(definition));
}
`;
}

function surfaceRootTemplate(
  framework: ReactSurfaceFramework,
  title: string,
  applicationEntry: string | undefined,
): string {
  const directive = framework === "next" ? '"use client";\n\n' : "";
  const applicationImport = applicationEntry
    ? `import Application from ${JSON.stringify(applicationEntry)};\n`
    : "";
  const application = applicationEntry
    ? "<Application />"
    : `<main className="generated-surface"><strong>${escapeJsxText(title)}</strong></main>`;
  return `${directive}import type { ReactSurfaceProps } from "dsh-react-surface/client";
${applicationImport}
import "./surface.css";

export function SurfaceRoot(_props: ReactSurfaceProps) {
  return ${application};
}
`;
}

function detectFramework(manifest: ProjectManifest): ReactSurfaceFramework {
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
  };
  return "next" in dependencies ? "next" : "vite";
}

async function detectApplicationEntry(
  projectDirectory: string,
  framework: ReactSurfaceFramework,
): Promise<string | undefined> {
  if (framework === "next") return undefined;
  for (const candidate of ["src/App.tsx", "src/App.jsx"]) {
    const path = join(projectDirectory, candidate);
    try {
      await readFile(path, "utf8");
      return path;
    } catch {
      // Try the next conventional Vite entry.
    }
  }
  return undefined;
}

async function assertFilesAbsent(files: readonly PlannedFile[]): Promise<void> {
  for (const file of files) {
    try {
      await readFile(file.path, "utf8");
      throw new Error(`Refusing to overwrite existing file: ${file.path}`);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
  }
}

function assertInsideProject(projectDirectory: string, target: string): void {
  const relativeTarget = relative(projectDirectory, target);
  if (
    relativeTarget === "" ||
    (!isAbsolute(relativeTarget) &&
      relativeTarget !== ".." &&
      !relativeTarget.startsWith(`..${sep}`))
  ) {
    return;
  }
  throw new Error(
    "Generated Surface files must stay inside the application project",
  );
}

function packageSlug(name: string): string {
  const slug = name
    .replace(/^@[^/]+\//, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "react-application";
}

function displayName(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function fileDependency(
  fromDirectory: string,
  targetDirectory: string,
): string {
  const path = relative(fromDirectory, targetDirectory).split(sep).join("/");
  return `file:${path.startsWith(".") ? path : `./${path}`}`;
}

function moduleSpecifier(fromDirectory: string, target: string): string {
  const path = relative(fromDirectory, target)
    .split(sep)
    .join("/")
    .replace(/\.(?:jsx|tsx)$/, "");
  return path.startsWith(".") ? path : `./${path}`;
}

function escapeJsxText(value: string): string {
  return value.replace(/[<>{}]/g, "");
}
