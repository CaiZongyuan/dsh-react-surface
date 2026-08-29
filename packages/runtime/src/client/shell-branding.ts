import type {
  ReactSurfaceBranding,
  ReactSurfaceBrandTokens,
} from "./contracts.ts";

const SURFACE_TOKEN_NAMES: Readonly<
  Record<keyof ReactSurfaceBrandTokens, string>
> = Object.freeze({
  accent: "--dsh-surface-accent",
  accentForeground: "--dsh-surface-accent-foreground",
  background: "--dsh-surface-background",
  border: "--dsh-surface-border",
  elevated: "--dsh-surface-elevated",
  fontFamily: "--dsh-surface-font-family",
  foreground: "--dsh-surface-foreground",
  mutedForeground: "--dsh-surface-muted-foreground",
  radius: "--dsh-surface-radius",
  surface: "--dsh-surface-surface",
});

/** Stable Surface tokens plus the tested DSH rc.2 aliases used for shell branding. */
export function buildSurfaceBrandDeclarations(
  branding: ReactSurfaceBranding | undefined,
): ReadonlyMap<string, string> {
  const tokens = branding?.tokens ?? {};
  const declarations = new Map<string, string>();
  for (const [key, cssName] of Object.entries(SURFACE_TOKEN_NAMES) as Array<
    [keyof ReactSurfaceBrandTokens, string]
  >) {
    const value = tokens[key];
    if (value !== undefined) declarations.set(cssName, value);
  }
  if (branding?.shell !== "surface") return declarations;

  mapToken(declarations, tokens.background, ["--dsw-alias-bg-base"]);
  mapToken(declarations, tokens.surface, [
    "--dsw-alias-bg-layer-1",
    "--dsw-alias-bg-overlay",
    "--dsw-specific-input-major",
    "--dsw-specific-menu",
    "--dsw-specific-sidebar-fill",
  ]);
  mapToken(declarations, tokens.elevated ?? tokens.surface, [
    "--dsw-alias-bg-layer-2",
    "--dsw-alias-bg-layer-3",
    "--dsw-specific-selector",
  ]);
  mapToken(declarations, tokens.foreground, [
    "--dsw-alias-label-primary",
    "--dsw-alias-label-primary-foreground",
  ]);
  mapToken(declarations, tokens.mutedForeground, [
    "--dsw-alias-label-dimmed",
    "--dsw-alias-label-secondary",
    "--dsw-alias-label-tertiary",
  ]);
  mapToken(declarations, tokens.border, [
    "--dsw-alias-border-l1",
    "--dsw-alias-border-l2",
    "--dsw-alias-border-l3",
  ]);
  mapToken(declarations, tokens.accent, [
    "--dsw-alias-brand-primary",
    "--dsw-alias-brand-text",
    "--dsw-alias-button-primary-fill",
    "--dsw-specific-sidebar-nav-item-active-accent",
  ]);
  mapToken(declarations, tokens.accentForeground, [
    "--dsw-alias-brand-primary-invert",
  ]);
  mapToken(declarations, tokens.fontFamily, ["--dsw-font-family"]);

  if (tokens.background && tokens.accent) {
    declarations.set(
      "--dsw-alias-interactive-bg-active",
      mix(tokens.background, 82, tokens.accent),
    );
    declarations.set(
      "--dsw-alias-interactive-bg-hover-accent",
      mix(tokens.background, 88, tokens.accent),
    );
    declarations.set(
      "--dsw-specific-sidebar-nav-item-active",
      mix(tokens.background, 86, tokens.accent),
    );
  }
  return declarations;
}

function mapToken(
  target: Map<string, string>,
  value: string | undefined,
  names: readonly string[],
): void {
  if (value === undefined) return;
  for (const name of names) target.set(name, value);
}

function mix(left: string, leftPercent: number, right: string): string {
  return `color-mix(in srgb, ${left} ${leftPercent}%, ${right})`;
}
