import { mkdir, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

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
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-ui-primitives",
]);

export async function buildDshReactPackage({
  packageDirectory: packageDirectoryInput,
  repositoryRoot: repositoryRootInput = process.cwd(),
}: DshReactPackageBuildOptions): Promise<DshReactPackageBuildResult> {
  const repositoryRoot = resolve(repositoryRootInput);
  const packageDirectory = resolve(packageDirectoryInput);
  const relativePackageDirectory = relative(repositoryRoot, packageDirectory);

  if (
    isAbsolute(relativePackageDirectory) ||
    relativePackageDirectory.startsWith("..")
  ) {
    throw new Error("Package directory must stay inside the repository");
  }

  const manifestPath = join(packageDirectory, "package.json");
  const manifestFile = Bun.file(manifestPath);
  if (!(await manifestFile.exists())) {
    throw new Error(`Missing package manifest: ${manifestPath}`);
  }

  const manifest = (await manifestFile.json()) as PackageManifest;
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
  });

  if (!clientBuild.success) {
    throw new AggregateError(
      clientBuild.logs,
      `Client build failed for ${manifest.name}`,
    );
  }
  if (clientBuild.outputs.length !== 1) {
    throw new Error(
      `${manifest.name} must emit one self-contained client entry; received ${clientBuild.outputs.length} outputs`,
    );
  }

  const clientOutput = clientBuild.outputs.find(
    (output) => output.kind === "entry-point",
  );
  if (!clientOutput) {
    throw new Error(`Client build emitted no entry point for ${manifest.name}`);
  }

  const bundledClient = await clientOutput.text();
  const clientPath = join(outDirectory, "client.js");
  const hostPath = join(outDirectory, "index.js");
  const wrappedClient = `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(manifest.name)},\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n${indent(bundledClient, 4)}\n    return module.exports;\n  },\n});\n`;

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
