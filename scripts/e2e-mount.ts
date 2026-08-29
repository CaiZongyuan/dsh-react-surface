import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";

const repositoryRoot = resolve(import.meta.dir, "..");
const scratchRoot = await mkdtemp(join(tmpdir(), "dsh-react-surface-e2e-"));
const dshHome = join(scratchRoot, "home");
const artifactsDirectory = join(scratchRoot, "artifacts");
const resultsDirectory = join(repositoryRoot, "test-results", "mount");
const profileDirectory = join(dshHome, "profiles", "web");
const dshCommand =
  process.env.DSH_CMD ?? (process.platform === "win32" ? "dsh.cmd" : "dsh");
let server: ReturnType<typeof Bun.spawn> | undefined;

try {
  await mkdir(profileDirectory, { recursive: true });
  await mkdir(artifactsDirectory, { recursive: true });
  await mkdir(resultsDirectory, { recursive: true });
  await writeProfile(profileDirectory);

  const runtimeTarball = await pack(
    join(repositoryRoot, "packages", "runtime"),
    artifactsDirectory,
  );
  const exampleTarball = await pack(
    join(repositoryRoot, "examples", "basic-surface"),
    artifactsDirectory,
  );
  const agentExampleTarball = await pack(
    join(repositoryRoot, "examples", "ag-ui-tools"),
    artifactsDirectory,
  );
  const agUiDirectory = process.env.DSH_AG_UI_DIR
    ? resolve(process.env.DSH_AG_UI_DIR)
    : undefined;
  const agUiTarball = agUiDirectory
    ? await pack(agUiDirectory, artifactsDirectory, true)
    : undefined;
  const environment = {
    ...process.env,
    DSH_HOME: dshHome,
    DSH_TELEMETRY_DISABLED: "1",
  };
  if (agUiTarball) {
    await run(
      dshCommand,
      ["plugin", "--profile", "web", "add", `file:${agUiTarball}`],
      { cwd: repositoryRoot, env: environment },
    );
  }
  await run(
    dshCommand,
    ["plugin", "--profile", "web", "add", `file:${runtimeTarball}`],
    { cwd: repositoryRoot, env: environment },
  );
  await run(
    dshCommand,
    ["plugin", "--profile", "web", "add", `file:${agentExampleTarball}`],
    { cwd: repositoryRoot, env: environment },
  );
  await run(
    dshCommand,
    ["plugin", "--profile", "web", "add", `file:${exampleTarball}`],
    { cwd: repositoryRoot, env: environment },
  );

  server = Bun.spawn([dshCommand, "web", "--port", "0"], {
    cwd: repositoryRoot,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const serverStdout = server.stdout as ReadableStream<Uint8Array>;
  const serverStderr = server.stderr as ReadableStream<Uint8Array>;
  const stderrPromise = readStream(serverStderr);
  const { url, output } = await waitForDshUrl(serverStdout, 120_000);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await dismissOnboarding(page);
    const launcher = page.locator(
      '[data-dsh-react-surface-launcher] button[aria-haspopup="menu"]',
    );
    await expect(launcher).toBeVisible({ timeout: 30_000 });
    try {
      await launcher.click();
    } catch (error) {
      await page.screenshot({
        path: join(resultsDirectory, "startup-blocked.png"),
        fullPage: true,
      });
      const dialogs = await page
        .locator('[role="dialog"], [role="presentation"]')
        .allTextContents();
      const buttons = await page.getByRole("button").allTextContents();
      throw new Error(
        `DSH startup blocked the launcher. Dialogs: ${JSON.stringify(dialogs)} Buttons: ${JSON.stringify(buttons)}`,
        { cause: error },
      );
    }
    await page.getByRole("menuitem", { name: /Basic Surface/ }).click();

    const layer = page.locator("[data-dsh-react-surface-layer]");
    await expect(layer).toHaveAttribute("data-surface-layout", "workspace");
    const counter = page.locator(
      '[data-surface-id="example.basic"] .counter-value',
    );
    await expect(counter).toHaveText("0");
    await page
      .locator(
        '[data-surface-id="example.basic"] button[aria-label="Increase counter"]',
      )
      .click();
    await expect(counter).toHaveText("1");
    await page.screenshot({
      path: join(resultsDirectory, "workspace-desktop.png"),
      fullPage: true,
    });

    await launcher.click();
    await page
      .getByRole("combobox", { name: "Layout for Basic Surface" })
      .selectOption("right-panel");
    await page
      .locator("[data-dsh-react-surface-menu-backdrop]")
      .click({ position: { x: 2, y: 2 } });
    await expect(layer).toHaveAttribute("data-surface-layout", "right-panel");
    const separator = page.locator('[role="separator"]');
    await expect(separator).toBeVisible();
    await separator.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(separator).toHaveAttribute("aria-valuenow", "436");
    await expect(
      page.locator("[data-dsh-react-surface-brand-name]"),
    ).toHaveText("React Surface");

    await page.keyboard.press("Escape");
    await expect(layer).toHaveAttribute("aria-hidden", "true");
    await launcher.click();
    await page.getByRole("menuitem", { name: /Agent Tools/ }).click();
    await expect(page.locator(".tool-status")).toHaveText(
      agUiTarball ? "idle" : "unavailable",
    );
    if (agUiTarball) {
      const capabilityResponse = await page.request.post(
        `${new URL(url).origin}/react-surface-agent/capabilities`,
        { data: {} },
      );
      expect(capabilityResponse.status()).toBe(200);
    }
    await page
      .locator(
        '[data-surface-id="example.ag-ui-tools"] button[aria-label="Close Surface"]',
      )
      .click();
    await launcher.click();
    await page.getByRole("menuitem", { name: /Basic Surface/ }).click();
    await expect(counter).toHaveText("1");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(layer).toHaveAttribute("data-surface-layout", "full-frame");
    await expect(counter).toHaveText("1");
    await page.screenshot({
      path: join(resultsDirectory, "surface-mobile.png"),
      fullPage: true,
    });

    await page.keyboard.press("Escape");
    await expect(layer).toHaveAttribute("aria-hidden", "true");
    expect(pageErrors, `DSH page errors:\n${pageErrors.join("\n")}`).toEqual(
      [],
    );
  } finally {
    await browser.close();
  }

  const inspectionMs = Number(process.env.DSH_E2E_INSPECT_MS ?? 0);
  if (Number.isFinite(inspectionMs) && inspectionMs > 0) {
    console.log(`Agent-browser inspection URL: ${url}`);
    await new Promise((resolve) => setTimeout(resolve, inspectionMs));
  }
  console.log(`Real DSH mount passed: ${url}`);
  console.log(output.trim());
  const stderr = await settleServer(server, stderrPromise);
  if (/duplicate prefix route|React surface crashed/i.test(stderr)) {
    throw new Error(`DSH reported a plugin crash:\n${stderr}`);
  }
} finally {
  if (server) await stopProcess(server);
  await rm(scratchRoot, { recursive: true, force: true });
}

async function writeProfile(directory: string): Promise<void> {
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify(
      {
        name: "dsh-react-surface-e2e-profile",
        private: true,
        dependencies: {},
        dsh: {
          profile: {
            bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(join(directory, "cordis.patch.yml"), "[]\n", "utf8");
  await writeFile(
    join(directory, "pnpm-workspace.yaml"),
    `packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: true\n\nallowBuilds:\n  node-pty: true\n  protobufjs: true\n\nminimumReleaseAgeExclude:\n  - dsh-react-surface\n  - dsh-react-surface-example-basic\n  - dsh-react-surface-example-ag-ui-tools\n  - dsh-ag-ui\n`,
    "utf8",
  );
}

async function dismissOnboarding(
  page: import("@playwright/test").Page,
): Promise<void> {
  const actionPattern =
    /^(Continue|Configure later|继续|稍后配置|暂不配置|稍后)$/;
  try {
    await expect
      .poll(() => page.getByRole("button", { name: actionPattern }).count(), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
  } catch {
    return;
  }
  for (let round = 0; round < 8; round += 1) {
    let dismissed = false;
    const buttons = page.getByRole("button", { name: actionPattern });
    for (let index = 0; index < (await buttons.count()); index += 1) {
      const button = buttons.nth(index);
      try {
        await button.click({ timeout: 4_000 });
        dismissed = true;
        await page.waitForTimeout(250);
      } catch {
        // A second onboarding layer can temporarily mask this one.
      }
    }
    if (!dismissed) break;
  }
}

async function pack(
  directory: string,
  destination: string,
  ignoreScripts = false,
): Promise<string> {
  const args = ["pack", "--silent", "--pack-destination", destination];
  if (ignoreScripts) args.push("--ignore-scripts");
  const output = await run(
    process.platform === "win32" ? "npm.cmd" : "npm",
    args,
    { cwd: directory, env: process.env },
  );
  const file = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .findLast((line) => line.endsWith(".tgz"));
  if (!file) throw new Error(`npm pack produced no tarball for ${directory}`);
  return join(destination, file);
}

async function run(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: Record<string, string | undefined> },
): Promise<string> {
  const process = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    readStream(process.stdout),
    readStream(process.stderr),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${exitCode})\n${stderr}\n${stdout}`,
    );
  }
  return stdout;
}

async function waitForDshUrl(
  stream: ReadableStream<Uint8Array>,
  timeoutMs: number,
): Promise<{ url: string; output: string }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const result = await withTimeout(
      reader.read(),
      remaining,
      "Timed out waiting for DSH web",
    );
    if (result.done) break;
    output += decoder.decode(result.value, { stream: true });
    const match = output.match(
      /http:\/\/127\.0\.0\.1:\d+(?:\/?\?token=[A-Za-z0-9_-]+)?/,
    );
    if (match?.[0]) return { url: match[0], output };
  }
  throw new Error(`DSH web did not report a URL\n${output}`);
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

async function settleServer(
  subprocess: ReturnType<typeof Bun.spawn>,
  stderr: Promise<string>,
): Promise<string> {
  await stopProcess(subprocess);
  try {
    return await withTimeout(stderr, 2_000, "Timed out draining DSH stderr");
  } catch {
    return "";
  }
}

async function stopProcess(
  subprocess: ReturnType<typeof Bun.spawn>,
): Promise<void> {
  if (subprocess.exitCode !== null) return;
  if (process.platform === "win32") {
    const killer = Bun.spawn(
      ["taskkill", "/PID", String(subprocess.pid), "/T", "/F"],
      { stdout: "ignore", stderr: "ignore" },
    );
    await killer.exited;
  } else {
    subprocess.kill();
    let stopped = false;
    try {
      await withTimeout(subprocess.exited, 5_000, "Timed out stopping DSH");
      stopped = true;
    } catch {
      stopped = false;
    }
    if (!stopped && subprocess.exitCode === null) subprocess.kill(9);
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
