export const REACT_SURFACE_INTERFACE_VERSION = 1 as const;
export const REACT_SURFACE_RUNTIME_VERSION = "0.0.1";

export const REACT_SURFACE_FEATURES = Object.freeze([
  "agent-tools-v1",
  "diagnostics-v1",
  "lazy-mount-v1",
  "layout-preferences-v1",
  "layout-presets-v1",
  "shell-branding-v1",
  "shadow-root-v1",
] as const);

export type ReactSurfaceFeature = (typeof REACT_SURFACE_FEATURES)[number];
