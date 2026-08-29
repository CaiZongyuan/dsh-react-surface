import type { ComponentType } from "react";

import type { ReactSurfaceFeature } from "./runtime-metadata.ts";

export type ReactSurfaceLayout =
  "full-frame" | "center" | "workspace" | "right-panel" | "bottom-panel";

export interface ReactSurfaceSizeConstraint {
  /** Preferred panel size in CSS pixels. */
  initial?: number;
  /** Smallest usable panel size in CSS pixels. */
  min?: number;
  /** Largest usable panel size in CSS pixels. */
  max?: number;
}

export interface ReactSurfaceLayoutConfiguration {
  /** Layout selected before a user preference exists. */
  default: ReactSurfaceLayout;
  /** Layouts offered by the DSH launcher. Defaults to only `default`. */
  supported?: readonly ReactSurfaceLayout[];
  /** Whether workspace panel separators can be dragged. */
  resizable?: boolean;
  /** Whether layout and panel sizes are retained locally. */
  persist?: boolean;
  /** Safe layout used when the requested split cannot fit. */
  fallback?: "full-frame" | "center";
  /** Minimum application width before a horizontal split falls back. */
  minSurfaceWidth?: number;
  /** Minimum application height before a vertical split falls back. */
  minSurfaceHeight?: number;
  /** Native DSH conversation width in the workspace preset. */
  conversation?: ReactSurfaceSizeConstraint;
  /** Application panel width in the right-panel preset. */
  rightPanel?: ReactSurfaceSizeConstraint;
  /** Application panel height in the bottom-panel preset. */
  bottomPanel?: ReactSurfaceSizeConstraint;
}

export type ReactSurfaceLayoutDeclaration =
  ReactSurfaceLayout | ReactSurfaceLayoutConfiguration;

export type ReactSurfaceLifecycleMount = "eager" | "lazy";
export type ReactSurfaceLifecycleRetention = "keep-alive" | "unmount-on-close";

export interface ReactSurfaceLifecycle {
  /** Lazy surfaces mount on first open. */
  mount?: ReactSurfaceLifecycleMount;
  /** Whether a hidden surface stays mounted. */
  retention?: ReactSurfaceLifecycleRetention;
}

export interface ReactSurfaceBrandTokens {
  accent?: string;
  accentForeground?: string;
  background?: string;
  border?: string;
  elevated?: string;
  fontFamily?: string;
  foreground?: string;
  mutedForeground?: string;
  radius?: string;
  surface?: string;
}

export interface ReactSurfaceBranding {
  /** Apply brand tokens only to the Surface or coordinate the DSH shell too. */
  shell?: "preserve" | "surface";
  colorScheme?: "light" | "dark" | "system";
  /** Optional product identity shown through official DSH Sidebar brand slots. */
  identity?: {
    name: string;
    mark?: string;
  };
  tokens?: Readonly<ReactSurfaceBrandTokens>;
}

export type ReactSurfaceAgentStatus =
  "unavailable" | "idle" | "connecting" | "active" | "contended" | "error";

export interface ReactSurfaceAgentCapability {
  readonly available: boolean;
  readonly status: ReactSurfaceAgentStatus;
  readonly reason?: string;
}

export interface ReactSurfaceCapabilities {
  readonly agent: ReactSurfaceAgentCapability;
}

export interface ReactSurfaceAgentTool {
  /** Provider-safe name registered only on the bound native DSH Agent. */
  name: string;
  /** Model-facing description of this browser-owned capability. */
  description: string;
  /** Object-rooted JSON Schema accepted by the DSH Tool runtime. */
  parameters: Record<string, unknown>;
  /** Execute against the current application state. */
  execute(input: unknown, signal: AbortSignal): string | Promise<string>;
}

export interface ReactSurfaceAgentRegistration {
  /** Stable application context identity, such as document:<id>. */
  scopeKey: string;
  /** Compact user-facing binding label. */
  label: string;
  /** Capabilities exposed only while this Surface and one DSH Session are active. */
  tools: readonly ReactSurfaceAgentTool[];
}

export interface ReactSurfaceAgentController {
  /** Publish the current route's replaceable Agent context and capabilities. */
  register(registration: ReactSurfaceAgentRegistration): () => void;
}

export interface ReactSurfaceProps {
  /** Whether this Surface is currently visible. */
  active: boolean;
  /** Application-owned location retained while the Surface is hidden. */
  location: string;
  /** Portal target inside this Surface's isolated ShadowRoot. */
  portalRoot: ShadowRoot;
  /** Native DSH Session capability registration for this Surface. */
  agent: ReactSurfaceAgentController;
  /** Runtime capabilities, including optional community-plugin integrations. */
  capabilities: ReactSurfaceCapabilities;
  /** Layout currently selected for this Surface. */
  layout: ReactSurfaceLayout;
  /** Return to the native DSH workspace. */
  close(): void;
  /** Change this Surface's application-owned location. */
  navigate(location: string): void;
}

export interface ReactSurfaceDefinition {
  /** Stable package-wide identifier. */
  id: string;
  /** User-facing application name. */
  title: string;
  /** Compact launcher and diagnostics description. */
  description?: string;
  /** React application root rendered with DSH's shared React runtime. */
  component: ComponentType<ReactSurfaceProps>;
  /** CSS text installed only inside this application's ShadowRoot. */
  styles?: string;
  /** Lower values appear first in the DSH launcher. */
  order?: number;
  /** Initial application-owned location. */
  initialLocation?: string;
  /** Semantic shell placement and optional resize constraints. */
  layout?: ReactSurfaceLayoutDeclaration;
  /** Surface and optional DSH shell brand coordination. */
  branding?: ReactSurfaceBranding;
  /** Mount and hidden-state retention policy. */
  lifecycle?: ReactSurfaceLifecycle;
}

export interface RegisteredReactSurface {
  readonly definition: Readonly<ReactSurfaceDefinition>;
  readonly location: string;
  readonly layout: ReactSurfaceLayout;
  readonly mounted: boolean;
}

export interface ReactSurfaceShellDiagnostics {
  readonly compatible: boolean;
  readonly requestedLayout: ReactSurfaceLayout | null;
  readonly resolvedLayout: ReactSurfaceLayout | null;
  readonly reason?: string;
}

export interface ReactSurfaceRuntimeSnapshot {
  readonly interfaceVersion: number;
  readonly version: string;
  readonly features: readonly ReactSurfaceFeature[];
  readonly capabilities: ReactSurfaceCapabilities;
  readonly shell: ReactSurfaceShellDiagnostics;
}

export interface ReactSurfaceSnapshot {
  readonly activeId: string | null;
  readonly surfaces: readonly RegisteredReactSurface[];
  readonly runtime: ReactSurfaceRuntimeSnapshot;
}

export interface ReactSurfaceDiagnostics {
  readonly runtime: ReactSurfaceRuntimeSnapshot;
  readonly activeId: string | null;
  readonly surfaces: readonly {
    id: string;
    layout: ReactSurfaceLayout;
    mounted: boolean;
    registeredAgentTools: number;
  }[];
}

export interface ReactSurfaceRegistry {
  readonly version: string;
  readonly features: readonly ReactSurfaceFeature[];
  /** Register one application for the lifetime of its owning DSH plugin. */
  register(definition: ReactSurfaceDefinition): () => void;
  /** Register one replaceable Agent capability set owned by a Surface render. */
  registerAgent(
    surfaceId: string,
    registration: ReactSurfaceAgentRegistration,
  ): () => void;
  /** Read the current capability set without serializing Tool functions. */
  getAgentRegistration(
    surfaceId: string,
  ): ReactSurfaceAgentRegistration | undefined;
  /** Show a registered application, optionally replacing its location. */
  open(id: string, location?: string): void;
  /** Reveal the native DSH workspace. */
  close(): void;
  /** Navigate the currently active application. */
  navigate(location: string): void;
  /** Select one of the layouts declared by a Surface. */
  setLayout(id: string, layout: ReactSurfaceLayout): void;
  /** Clear retained UI-only layout preferences. */
  resetPreferences(id?: string): void;
  /** Produce a local-only diagnostic report without application data. */
  inspect(): ReactSurfaceDiagnostics;
  /** Stable external-store snapshot for React and non-React consumers. */
  getSnapshot(): ReactSurfaceSnapshot;
  /** Observe registry, visibility, layout, and capability changes. */
  subscribe(listener: () => void): () => void;
}

export function defineReactSurface(
  definition: ReactSurfaceDefinition,
): Readonly<ReactSurfaceDefinition> {
  validateSurfaceDefinition(definition);
  return Object.freeze({ ...definition });
}

export function validateSurfaceDefinition(
  definition: ReactSurfaceDefinition,
): void {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(definition.id)) {
    throw new TypeError(
      `React surface id must use lowercase letters, numbers, dots, and hyphens: ${definition.id}`,
    );
  }
  if (!definition.title.trim()) {
    throw new TypeError("React surface title must not be empty");
  }
  if (typeof definition.component !== "function") {
    throw new TypeError("React surface component must be a function");
  }
  if (definition.initialLocation?.includes("\0")) {
    throw new TypeError("React surface location must not contain NUL");
  }
  validateLayoutDeclaration(definition.layout);
  validateBranding(definition.branding);
  validateLifecycle(definition.lifecycle);
}

const VALID_LAYOUTS = new Set<ReactSurfaceLayout>([
  "full-frame",
  "center",
  "workspace",
  "right-panel",
  "bottom-panel",
]);

function validateLayoutDeclaration(
  declaration: ReactSurfaceLayoutDeclaration | undefined,
): void {
  if (declaration === undefined) return;
  if (typeof declaration === "string") {
    requireLayout(declaration);
    return;
  }
  requireLayout(declaration.default);
  const supported = declaration.supported ?? [declaration.default];
  if (!Array.isArray(supported) || supported.length === 0) {
    throw new TypeError("React surface supported layouts must not be empty");
  }
  for (const layout of supported) requireLayout(layout);
  if (!supported.includes(declaration.default)) {
    throw new TypeError("React surface supported layouts must include default");
  }
  if (
    declaration.fallback !== undefined &&
    declaration.fallback !== "full-frame" &&
    declaration.fallback !== "center"
  ) {
    throw new TypeError(
      `Unknown React surface fallback: ${declaration.fallback}`,
    );
  }
  validatePositiveNumber(declaration.minSurfaceWidth, "minSurfaceWidth");
  validatePositiveNumber(declaration.minSurfaceHeight, "minSurfaceHeight");
  validateSizeConstraint(declaration.conversation, "conversation");
  validateSizeConstraint(declaration.rightPanel, "rightPanel");
  validateSizeConstraint(declaration.bottomPanel, "bottomPanel");
}

function requireLayout(value: unknown): asserts value is ReactSurfaceLayout {
  if (
    typeof value !== "string" ||
    !VALID_LAYOUTS.has(value as ReactSurfaceLayout)
  ) {
    throw new TypeError(`Unknown React surface layout: ${String(value)}`);
  }
}

function validateSizeConstraint(
  value: ReactSurfaceSizeConstraint | undefined,
  name: string,
): void {
  if (value === undefined) return;
  validatePositiveNumber(value.initial, `${name}.initial`);
  validatePositiveNumber(value.min, `${name}.min`);
  validatePositiveNumber(value.max, `${name}.max`);
  if (
    value.min !== undefined &&
    value.max !== undefined &&
    value.min > value.max
  ) {
    throw new TypeError(`React surface ${name}.min must not exceed max`);
  }
}

function validatePositiveNumber(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new TypeError(`React surface ${name} must be a positive number`);
  }
}

function validateBranding(branding: ReactSurfaceBranding | undefined): void {
  if (branding === undefined) return;
  if (
    branding.shell !== undefined &&
    branding.shell !== "preserve" &&
    branding.shell !== "surface"
  ) {
    throw new TypeError(
      `Unknown React surface shell branding: ${branding.shell}`,
    );
  }
  if (branding.identity !== undefined) {
    if (
      !branding.identity.name.trim() ||
      branding.identity.name.length > 64 ||
      branding.identity.name.includes("\0")
    ) {
      throw new TypeError("React surface brand identity name is invalid");
    }
    if (
      branding.identity.mark !== undefined &&
      (!branding.identity.mark.trim() ||
        branding.identity.mark.length > 4 ||
        branding.identity.mark.includes("\0"))
    ) {
      throw new TypeError("React surface brand identity mark is invalid");
    }
  }
  if (
    branding.colorScheme !== undefined &&
    branding.colorScheme !== "light" &&
    branding.colorScheme !== "dark" &&
    branding.colorScheme !== "system"
  ) {
    throw new TypeError(
      `Unknown React surface color scheme: ${branding.colorScheme}`,
    );
  }
  for (const [name, value] of Object.entries(branding.tokens ?? {})) {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > 256 ||
      /[{}]/.test(value)
    ) {
      throw new TypeError(`React surface brand token is invalid: ${name}`);
    }
  }
}

function validateLifecycle(lifecycle: ReactSurfaceLifecycle | undefined): void {
  if (lifecycle === undefined) return;
  if (
    lifecycle.mount !== undefined &&
    lifecycle.mount !== "eager" &&
    lifecycle.mount !== "lazy"
  ) {
    throw new TypeError(
      `Unknown React surface mount policy: ${lifecycle.mount}`,
    );
  }
  if (
    lifecycle.retention !== undefined &&
    lifecycle.retention !== "keep-alive" &&
    lifecycle.retention !== "unmount-on-close"
  ) {
    throw new TypeError(
      `Unknown React surface retention policy: ${lifecycle.retention}`,
    );
  }
}

export function getReactSurfaceLayoutConfiguration(
  definition: Pick<ReactSurfaceDefinition, "layout">,
): Readonly<
  Required<
    Pick<
      ReactSurfaceLayoutConfiguration,
      "default" | "supported" | "resizable" | "persist" | "fallback"
    >
  > &
    ReactSurfaceLayoutConfiguration
> {
  const declaration = definition.layout;
  const source =
    declaration === undefined || typeof declaration === "string"
      ? { default: declaration ?? "full-frame" }
      : declaration;
  return Object.freeze({
    ...source,
    default: source.default,
    supported: Object.freeze([...(source.supported ?? [source.default])]),
    resizable: source.resizable ?? true,
    persist: source.persist ?? true,
    fallback: source.fallback ?? "full-frame",
  });
}
