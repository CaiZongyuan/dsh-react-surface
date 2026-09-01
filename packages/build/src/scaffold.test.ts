import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { scaffoldReactSurface } from "./scaffold.ts";
import {
  buildDshReactPackage,
  DSH_CLIENT_BASELINE_EXTERNALS,
} from "./index.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function project(manifest: object) {
  const directory = await mkdtemp(join(tmpdir(), "dsh-react-surface-"));
  directories.push(directory);
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify(manifest),
    "utf8",
  );
  return directory;
}

describe("scaffoldReactSurface", () => {
  test("tracks the DSH Client platform module cohort", () => {
    expect(DSH_CLIENT_BASELINE_EXTERNALS).toContain(
      "@deepseek-ai/dsh-client-store",
    );
  });

  test("detects Vite and generates an isolated in-repository Adapter", async () => {
    const directory = await project({
      name: "@acme/dashboard",
      devDependencies: { vite: "latest" },
    });
    const result = await scaffoldReactSurface({ projectDirectory: directory });

    expect(result.framework).toBe("vite");
    expect(result.outputDirectory).toBe(join(directory, "integrations", "dsh"));
    const manifest = JSON.parse(
      await readFile(join(result.outputDirectory, "package.json"), "utf8"),
    ) as { name: string; dsh: { client: { external: string[] } } };
    expect(manifest.name).toBe("dashboard-dsh-surface");
    expect(manifest.dsh.client.external).toContain("dsh-react-surface/client");
    const entry = await readFile(
      join(result.outputDirectory, "src", "client", "index.tsx"),
      "utf8",
    );
    expect(entry).toContain('id: "app.dashboard"');
    expect(entry).toContain(
      'import type { Context as ClientContext } from "@deepseek-ai/cordis";',
    );
    expect(entry).not.toContain("dsh-client-runtime");
  });

  test("generates a client-only Next Surface template", async () => {
    const directory = await project({
      name: "portal",
      dependencies: { next: "latest", react: "latest" },
    });
    const result = await scaffoldReactSurface({ projectDirectory: directory });
    const root = await readFile(
      join(result.outputDirectory, "src", "client", "surface-root.tsx"),
      "utf8",
    );

    expect(result.framework).toBe("next");
    expect(root.startsWith('"use client";')).toBe(true);
    expect(root).not.toContain("next/navigation");
  });

  test("refuses to overwrite generated files or escape the project", async () => {
    const directory = await project({ name: "safe-app" });
    await scaffoldReactSurface({ projectDirectory: directory });

    await expect(
      scaffoldReactSurface({ projectDirectory: directory }),
    ).rejects.toThrow("Refusing to overwrite");
    await expect(
      scaffoldReactSurface({
        projectDirectory: directory,
        outputDirectory: "../outside",
      }),
    ).rejects.toThrow("must stay inside");
  });

  test("supports a write-free dry run", async () => {
    const directory = await project({ name: "dry-run" });
    const result = await scaffoldReactSurface({
      projectDirectory: directory,
      dryRun: true,
    });

    await expect(readFile(result.files[0]!, "utf8")).rejects.toThrow();
  });

  test("builds generated CSS into the Surface-owned ShadowRoot payload", async () => {
    const directory = await project({ name: "styled-app" });
    const generated = await scaffoldReactSurface({
      projectDirectory: directory,
    });

    await buildDshReactPackage({
      packageDirectory: generated.outputDirectory,
      repositoryRoot: directory,
    });
    const client = await readFile(
      join(generated.outputDirectory, "lib", "client.js"),
      "utf8",
    );
    expect(client).toContain("__DSH_REACT_SURFACE_STYLES__");
    expect(client).toContain(".generated-surface");
    expect(client).toContain("app.styled-app");
  });

  test("inlines small assets referenced by Surface CSS", async () => {
    const directory = await project({ name: "asset-app" });
    const generated = await scaffoldReactSurface({
      projectDirectory: directory,
    });
    const clientDirectory = join(generated.outputDirectory, "src", "client");
    await writeFile(
      join(clientDirectory, "logo.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>',
      "utf8",
    );
    await writeFile(
      join(clientDirectory, "surface.css"),
      '.generated-surface { background-image: url("./logo.svg"); }',
      "utf8",
    );

    await buildDshReactPackage({
      packageDirectory: generated.outputDirectory,
      repositoryRoot: directory,
    });
    const client = await readFile(
      join(generated.outputDirectory, "lib", "client.js"),
      "utf8",
    );
    expect(client).toContain("data:image/svg+xml,");
  });

  test("builds a detected Vite root outside the isolated Adapter", async () => {
    const directory = await project({ name: "existing-vite-app" });
    await mkdir(join(directory, "src"), { recursive: true });
    await writeFile(
      join(directory, "src", "App.tsx"),
      'import styles from "./app.module.css"; export default function App() { return <main className={styles.root}>Existing</main>; }',
      "utf8",
    );
    await writeFile(
      join(directory, "src", "app.module.css"),
      ".root { color: #123456; }",
      "utf8",
    );
    const generated = await scaffoldReactSurface({
      projectDirectory: directory,
    });

    await buildDshReactPackage({ packageDirectory: generated.outputDirectory });
    const client = await readFile(
      join(generated.outputDirectory, "lib", "client.js"),
      "utf8",
    );
    expect(client).toContain("Existing");
    expect(client).toContain("#123456");
  });
});
