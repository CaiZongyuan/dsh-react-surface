import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const packages = [
  {
    directory: "packages/runtime",
    id: "dsh-react-surface",
    allowedRequires: new Set(["react", "react/jsx-runtime", "react-dom"]),
  },
  {
    directory: "examples/basic-surface",
    id: "dsh-react-surface-example-basic",
    allowedRequires: new Set([
      "react",
      "react/jsx-runtime",
      "dsh-react-surface/client",
    ]),
  },
  {
    directory: "examples/ag-ui-tools",
    id: "dsh-react-surface-example-ag-ui-tools",
    allowedRequires: new Set([
      "react",
      "react/jsx-runtime",
      "dsh-react-surface/client",
    ]),
  },
];

for (const packageInfo of packages) {
  const libraryDirectory = join(repositoryRoot, packageInfo.directory, "lib");
  const files = Array.from(
    new Bun.Glob("**/*").scanSync({ cwd: libraryDirectory, onlyFiles: true }),
  ).sort();

  const unexpectedJavaScript = files.filter(
    (file) =>
      file.endsWith(".js") && file !== "client.js" && file !== "index.js",
  );
  if (unexpectedJavaScript.length) {
    throw new Error(
      `${packageInfo.id} emitted unexpected JavaScript chunks: ${unexpectedJavaScript.join(", ")}`,
    );
  }

  const clientPath = join(libraryDirectory, "client.js");
  const client = await Bun.file(clientPath).text();
  const expectedRegistration = `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(packageInfo.id)}`;

  if (!client.startsWith(expectedRegistration)) {
    throw new Error(`${packageInfo.id} has an invalid DSH client wrapper`);
  }
  if (/^\s*import\s/m.test(client)) {
    throw new Error(`${packageInfo.id} client contains an ESM import`);
  }
  if (client.includes("react.production.min")) {
    throw new Error(`${packageInfo.id} bundled a private React runtime`);
  }

  const requires = Array.from(
    client.matchAll(/require\(["']([^"']+)["']\)/g),
  ).flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
  const unsupportedRequires = requires.filter(
    (specifier) => !packageInfo.allowedRequires.has(specifier),
  );
  if (unsupportedRequires.length) {
    throw new Error(
      `${packageInfo.id} requests unsupported client modules: ${unsupportedRequires.join(", ")}`,
    );
  }
}

console.log("DSH client artifact contracts verified.");
