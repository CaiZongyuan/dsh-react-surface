#!/usr/bin/env bun

import { resolve } from "node:path";

import { buildDshReactPackage } from "./index.ts";

const packageArgument = Bun.argv[2];

if (!packageArgument) {
  throw new Error("Usage: dsh-react-surface-build <package-directory>");
}

await buildDshReactPackage({
  packageDirectory: resolve(process.cwd(), packageArgument),
  repositoryRoot: process.cwd(),
});
