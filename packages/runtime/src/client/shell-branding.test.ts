import { describe, expect, test } from "bun:test";

import { buildSurfaceBrandDeclarations } from "./shell-branding.ts";

describe("buildSurfaceBrandDeclarations", () => {
  test("keeps Surface-only tokens isolated from DSH aliases", () => {
    const declarations = buildSurfaceBrandDeclarations({
      shell: "preserve",
      tokens: { accent: "#0055aa", background: "#ffffff" },
    });

    expect(declarations.get("--dsh-surface-accent")).toBe("#0055aa");
    expect(declarations.has("--dsw-alias-brand-primary")).toBe(false);
  });

  test("coordinates semantic brand values with the DSH shell", () => {
    const declarations = buildSurfaceBrandDeclarations({
      shell: "surface",
      tokens: {
        accent: "#0055aa",
        background: "#ffffff",
        foreground: "#16181d",
        surface: "#f5f7fa",
      },
    });

    expect(declarations.get("--dsw-alias-bg-base")).toBe("#ffffff");
    expect(declarations.get("--dsw-specific-sidebar-fill")).toBe("#f5f7fa");
    expect(declarations.get("--dsw-alias-brand-primary")).toBe("#0055aa");
    expect(declarations.get("--dsw-alias-interactive-bg-active")).toContain(
      "color-mix",
    );
  });
});
