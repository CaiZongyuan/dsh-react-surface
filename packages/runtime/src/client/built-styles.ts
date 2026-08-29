declare global {
  interface Window {
    __DSH_REACT_SURFACE_STYLES__?: Record<string, string>;
  }
}

/** CSS extracted by the build adapter and keyed by the declared Surface id. */
export function getBundledSurfaceStyles(surfaceId: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  const value = window.__DSH_REACT_SURFACE_STYLES__?.[surfaceId];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
