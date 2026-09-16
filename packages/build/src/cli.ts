#!/usr/bin/env bun

import { resolve } from "node:path";

import { buildDshReactPackage } from "./index.ts";
import {
  scaffoldReactSurface,
  type ReactSurfaceFramework,
} from "./scaffold.ts";

const [commandOrDirectory, ...argumentsAfterCommand] = Bun.argv.slice(2);

if (!commandOrDirectory) {
  throw new Error(
    "Usage: dsh-react-surface-build <package-directory> | build <package-directory> | init <project-directory>",
  );
}

if (commandOrDirectory === "init") {
  const options = parseInitArguments(argumentsAfterCommand);
  const result = await scaffoldReactSurface(options);
  console.log(
    `${options.dryRun ? "Would create" : "Created"} ${result.framework} DSH Adapter at ${result.outputDirectory}`,
  );
  for (const file of result.files) console.log(`- ${file}`);
} else {
  const packageArgument =
    commandOrDirectory === "build"
      ? argumentsAfterCommand[0]
      : commandOrDirectory;
  if (!packageArgument) {
    throw new Error("Usage: dsh-react-surface-build build <package-directory>");
  }
  await buildDshReactPackage({
    packageDirectory: resolve(process.cwd(), packageArgument),
    repositoryRoot: process.cwd(),
  });
}

function parseInitArguments(args: readonly string[]) {
  let projectDirectory = ".";
  let outputDirectory: string | undefined;
  let framework: ReactSurfaceFramework | undefined;
  let applicationEntry: string | undefined;
  let surfaceId: string | undefined;
  let title: string | undefined;
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value) continue;
    if (!value.startsWith("-") && projectDirectory === ".") {
      projectDirectory = value;
      continue;
    }
    if (value === "--dry-run") {
      dryRun = true;
      continue;
    }
    const next = args[index + 1];
    if (!next) throw new Error(`Missing value after ${value}`);
    index += 1;
    switch (value) {
      case "--output":
        outputDirectory = next;
        break;
      case "--framework":
        if (next !== "vite" && next !== "next") {
          throw new Error("--framework must be vite or next");
        }
        framework = next;
        break;
      case "--entry":
        applicationEntry = next;
        break;
      case "--id":
        surfaceId = next;
        break;
      case "--title":
        title = next;
        break;
      default:
        throw new Error(`Unknown init option: ${value}`);
    }
  }

  return {
    projectDirectory,
    ...(outputDirectory === undefined ? {} : { outputDirectory }),
    ...(framework === undefined ? {} : { framework }),
    ...(applicationEntry === undefined ? {} : { applicationEntry }),
    ...(surfaceId === undefined ? {} : { surfaceId }),
    ...(title === undefined ? {} : { title }),
    dryRun,
  };
}
