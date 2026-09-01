import { mkdir, rm } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import postcss from "postcss";
import postcssUrl from "postcss-url";

export {
  scaffoldReactSurface,
  type ReactSurfaceFramework,
  type ScaffoldReactSurfaceOptions,
  type ScaffoldReactSurfaceResult,
} from "./scaffold.ts";

interface ClientManifest {
  external?: unknown;
  platform?: string;
}

interface PackageManifest {
  name?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  dsh?: {
    client?: ClientManifest;
    reactSurface?: {
      id?: unknown;
      projectRoot?: unknown;
    };
  };
}

export interface DshReactPackageBuildOptions {
  /** Package root containing package.json and src/client/index.tsx. */
  packageDirectory: string;
  /** Trusted project root that contains the package and its build output. */
  repositoryRoot?: string;
}

export interface DshReactPackageBuildResult {
  packageName: string;
  clientPath: string;
  hostPath: string;
}

export const DSH_CLIENT_BASELINE_EXTERNALS = Object.freeze([
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-client-store",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-ui-primitives",
]);

export async function buildDshReactPackage({
  packageDirectory: packageDirectoryInput,
  repositoryRoot: repositoryRootInput,
}: DshReactPackageBuildOptions): Promise<DshReactPackageBuildResult> {
  const packageDirectory = resolve(packageDirectoryInput);
  const manifestPath = join(packageDirectory, "package.json");
  const manifestFile = Bun.file(manifestPath);
  if (!(await manifestFile.exists())) {
    throw new Error(`Missing package manifest: ${manifestPath}`);
  }

  const manifest = (await manifestFile.json()) as PackageManifest;
  const declaredProjectRoot = manifest.dsh?.reactSurface?.projectRoot;
  if (
    declaredProjectRoot !== undefined &&
    (typeof declaredProjectRoot !== "string" ||
      isAbsolute(declaredProjectRoot) ||
      declaredProjectRoot.includes("\0"))
  ) {
    throw new TypeError("dsh.reactSurface.projectRoot must be a relative path");
  }
  const repositoryRoot = resolve(
    repositoryRootInput ??
      (typeof declaredProjectRoot === "string"
        ? join(packageDirectory, declaredProjectRoot)
        : process.cwd()),
  );
  const relativePackageDirectory = relative(repositoryRoot, packageDirectory);
  if (
    isAbsolute(relativePackageDirectory) ||
    relativePackageDirectory === ".." ||
    relativePackageDirectory.startsWith("../") ||
    relativePackageDirectory.startsWith("..\\")
  ) {
    throw new Error("Package directory must stay inside the repository");
  }
  if (!manifest.name) {
    throw new Error(`Package manifest has no name: ${manifestPath}`);
  }
  if (manifest.dsh?.client?.platform !== "web") {
    throw new Error(`${manifest.name} must declare dsh.client.platform as web`);
  }
  const requestedExternalsValue = manifest.dsh.client.external;
  if (
    requestedExternalsValue !== undefined &&
    (!Array.isArray(requestedExternalsValue) ||
      !requestedExternalsValue.every(
        (specifier) => typeof specifier === "string",
      ))
  ) {
    throw new TypeError(
      `${manifest.name} dsh.client.external must be a string array`,
    );
  }
  const requestedExternals = (requestedExternalsValue ?? []) as string[];

  const outDirectory = join(packageDirectory, "lib");
  const hostEntry = join(packageDirectory, "src", "index.ts");
  const clientEntry = join(packageDirectory, "src", "client", "index.tsx");

  await rm(outDirectory, { recursive: true, force: true });
  await mkdir(outDirectory, { recursive: true });

  const hostExternals = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ];

  const hostBuild = await Bun.build({
    entrypoints: [hostEntry],
    outdir: outDirectory,
    target: "node",
    format: "esm",
    external: hostExternals,
    naming: "[name].js",
  });

  if (!hostBuild.success) {
    throw new AggregateError(
      hostBuild.logs,
      `Host build failed for ${manifest.name}`,
    );
  }

  const clientExternals = Array.from(
    new Set([...DSH_CLIENT_BASELINE_EXTERNALS, ...requestedExternals]),
  );

  const clientBuild = await Bun.build({
    entrypoints: [clientEntry],
    target: "browser",
    format: "cjs",
    external: clientExternals,
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    plugins: [createCssAssetPlugin(repositoryRoot), INLINE_ASSET_PLUGIN],
  });

  if (!clientBuild.success) {
    throw new AggregateError(
      clientBuild.logs,
      `Client build failed for ${manifest.name}`,
    );
  }
  const clientOutput = clientBuild.outputs.find(
    (output) => output.kind === "entry-point" && output.path.endsWith(".js"),
  );
  if (!clientOutput) {
    throw new Error(
      `Client build emitted no JavaScript entry point for ${manifest.name}`,
    );
  }
  const cssOutputs = clientBuild.outputs.filter(
    (output) => output.path.endsWith(".css") || output.type === "text/css",
  );
  const unsupportedOutputs = clientBuild.outputs.filter(
    (output) => output !== clientOutput && !cssOutputs.includes(output),
  );
  if (unsupportedOutputs.length > 0) {
    throw new Error(
      `${manifest.name} emitted unsupported dynamic chunks or assets: ${unsupportedOutputs
        .map((output) => output.path)
        .join(", ")}`,
    );
  }
  const bundledStyles = (
    await Promise.all(cssOutputs.map((output) => output.text()))
  ).join("\n");
  const surfaceId = manifest.dsh?.reactSurface?.id;
  if (
    bundledStyles.length > 0 &&
    (typeof surfaceId !== "string" ||
      !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(surfaceId))
  ) {
    throw new Error(
      `${manifest.name} imports CSS and must declare dsh.reactSurface.id`,
    );
  }

  const bundledClient = await clientOutput.text();
  const clientPath = join(outDirectory, "client.js");
  const hostPath = join(outDirectory, "index.js");
  const styleRegistration =
    bundledStyles.length === 0
      ? ""
      : `window.__DSH_REACT_SURFACE_STYLES__ ??= Object.create(null);\nwindow.__DSH_REACT_SURFACE_STYLES__[${JSON.stringify(surfaceId)}] = ${JSON.stringify(bundledStyles)};\n`;
  const wrappedClient = `${styleRegistration}window.__ModuleLoader__.load({\n  id: ${JSON.stringify(manifest.name)},\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n${indent(bundledClient, 4)}\n    return module.exports;\n  },\n});\n`;

  await Bun.write(clientPath, wrappedClient);
  return { packageName: manifest.name, clientPath, hostPath };
}

function indent(value: string, spaces: number) {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

const INLINE_ASSET_MIME = Object.freeze({
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
} satisfies Record<string, string>);

const INLINE_ASSET_PLUGIN: Bun.BunPlugin = {
  name: "dsh-react-surface-inline-assets",
  setup(builder) {
    builder.onLoad(
      { filter: /\.(?:gif|jpe?g|png|svg|ttf|webp|woff2?)$/i },
      async ({ path }) => {
        const extension = extname(path).toLowerCase();
        const mime =
          INLINE_ASSET_MIME[extension as keyof typeof INLINE_ASSET_MIME];
        if (!mime) return undefined;
        const bytes = Buffer.from(await Bun.file(path).arrayBuffer());
        const url = `data:${mime};base64,${bytes.toString("base64")}`;
        return {
          contents: `export default ${JSON.stringify(url)};`,
          loader: "js",
        };
      },
    );
  },
};

function createCssAssetPlugin(repositoryRoot: string): Bun.BunPlugin {
  return {
    name: "dsh-react-surface-css-assets",
    setup(builder) {
      builder.onLoad({ filter: /\.css$/i }, async ({ path }) => {
        assertBuildPath(repositoryRoot, path, "CSS file");
        const source = await Bun.file(path).text();
        const result = await postcss([
          postcssUrl({
            url: "inline",
            maxSize: Number.POSITIVE_INFINITY,
          }),
        ]).process(source, { from: path });
        return { contents: result.css, loader: "css" };
      });
    },
  };
}

function assertBuildPath(root: string, target: string, label: string): void {
  const relativeTarget = relative(root, resolve(target));
  if (
    isAbsolute(relativeTarget) ||
    relativeTarget === ".." ||
    relativeTarget.startsWith("../") ||
    relativeTarget.startsWith("..\\")
  ) {
    throw new Error(`${label} must stay inside the repository`);
  }
}
