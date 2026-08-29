import type {
  ReactSurfaceLayout,
  ReactSurfaceLayoutConfiguration,
  ReactSurfaceSizeConstraint,
} from "./contracts.ts";
import type { ReactSurfacePanelSize } from "./surface-preferences.ts";

const DEFAULT_MIN_SURFACE_WIDTH = 520;
const DEFAULT_MIN_SURFACE_HEIGHT = 280;
const DEFAULT_MIN_NATIVE_WIDTH = 420;
const DEFAULT_MIN_NATIVE_HEIGHT = 320;

export interface ReactSurfaceShellGeometry {
  width: number;
  height: number;
  sidebarWidth: number;
  detailsWidth: number;
}

export interface ReactSurfaceBounds {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ReactSurfaceNativePaneLayout {
  width?: number;
  height?: number;
  justifySelf?: "start" | "end";
  alignSelf?: "start" | "end";
  borderLeft?: boolean;
  borderTop?: boolean;
}

export interface ReactSurfaceResizeDescriptor {
  key: ReactSurfacePanelSize;
  edge: "left" | "right" | "top";
  orientation: "horizontal" | "vertical";
  value: number;
  min: number;
  max: number;
}

export interface ReactSurfaceLayoutResolution {
  requested: ReactSurfaceLayout;
  resolved: ReactSurfaceLayout;
  bounds: ReactSurfaceBounds;
  nativePane: ReactSurfaceNativePaneLayout;
  resize?: ReactSurfaceResizeDescriptor;
  reason?: string;
}

export interface ResolveReactSurfaceLayoutInput {
  requested: ReactSurfaceLayout;
  configuration: ReactSurfaceLayoutConfiguration;
  geometry: ReactSurfaceShellGeometry;
  preferredSizes?: Partial<Record<ReactSurfacePanelSize, number>>;
}

/** Resolve semantic layouts without exposing DSH DOM structure to callers. */
export function resolveReactSurfaceLayout({
  requested,
  configuration,
  geometry,
  preferredSizes = {},
}: ResolveReactSurfaceLayoutInput): ReactSurfaceLayoutResolution {
  const cleanGeometry = {
    width: Math.max(0, geometry.width),
    height: Math.max(0, geometry.height),
    sidebarWidth: clamp(geometry.sidebarWidth, 0, geometry.width),
    detailsWidth: clamp(geometry.detailsWidth, 0, geometry.width),
  };

  switch (requested) {
    case "full-frame":
      return fullFrame(requested);
    case "center":
      return center(requested, configuration, cleanGeometry);
    case "workspace":
      return workspace(
        requested,
        configuration,
        cleanGeometry,
        preferredSizes.conversation,
      );
    case "right-panel":
      return rightPanel(
        requested,
        configuration,
        cleanGeometry,
        preferredSizes.rightPanel,
      );
    case "bottom-panel":
      return bottomPanel(
        requested,
        configuration,
        cleanGeometry,
        preferredSizes.bottomPanel,
      );
  }
}

function fullFrame(
  requested: ReactSurfaceLayout,
  reason?: string,
): ReactSurfaceLayoutResolution {
  return {
    requested,
    resolved: "full-frame",
    bounds: { top: 0, right: 0, bottom: 0, left: 0 },
    nativePane: {},
    ...(reason === undefined ? {} : { reason }),
  };
}

function center(
  requested: ReactSurfaceLayout,
  configuration: ReactSurfaceLayoutConfiguration,
  geometry: ReactSurfaceShellGeometry,
  reason?: string,
): ReactSurfaceLayoutResolution {
  const minSurfaceWidth =
    configuration.minSurfaceWidth ?? DEFAULT_MIN_SURFACE_WIDTH;
  if (geometry.width - geometry.sidebarWidth < minSurfaceWidth) {
    return fullFrame(
      requested,
      reason ?? "The center Surface is narrower than its minimum width",
    );
  }
  return {
    requested,
    resolved: "center",
    bounds: {
      top: 0,
      right: 0,
      bottom: 0,
      left: geometry.sidebarWidth,
    },
    nativePane: {},
    ...(reason === undefined ? {} : { reason }),
  };
}

function workspace(
  requested: ReactSurfaceLayout,
  configuration: ReactSurfaceLayoutConfiguration,
  geometry: ReactSurfaceShellGeometry,
  preferred: number | undefined,
): ReactSurfaceLayoutResolution {
  const available = Math.max(
    0,
    geometry.width - geometry.sidebarWidth - geometry.detailsWidth,
  );
  const minSurface = configuration.minSurfaceWidth ?? DEFAULT_MIN_SURFACE_WIDTH;
  const constraint = normalizeConstraint(configuration.conversation, {
    initial: Math.round(geometry.width * 0.31),
    min: 340,
    max: 440,
  });
  const maximum = Math.min(constraint.max, available - minSurface);
  if (maximum < constraint.min) {
    return fallback(
      requested,
      configuration,
      geometry,
      "The workspace split cannot satisfy both application and conversation minimum widths",
    );
  }
  const conversationWidth = clamp(
    preferred ?? constraint.initial,
    constraint.min,
    maximum,
  );
  return {
    requested,
    resolved: "workspace",
    bounds: {
      top: 0,
      right: geometry.detailsWidth + conversationWidth,
      bottom: 0,
      left: geometry.sidebarWidth,
    },
    nativePane: {
      width: conversationWidth,
      justifySelf: "end",
      borderLeft: true,
    },
    ...(configuration.resizable === false
      ? {}
      : {
          resize: {
            key: "conversation" as const,
            edge: "right" as const,
            orientation: "vertical" as const,
            value: conversationWidth,
            min: constraint.min,
            max: maximum,
          },
        }),
  };
}

function rightPanel(
  requested: ReactSurfaceLayout,
  configuration: ReactSurfaceLayoutConfiguration,
  geometry: ReactSurfaceShellGeometry,
  preferred: number | undefined,
): ReactSurfaceLayoutResolution {
  const available = Math.max(
    0,
    geometry.width - geometry.sidebarWidth - geometry.detailsWidth,
  );
  const constraint = normalizeConstraint(configuration.rightPanel, {
    initial: 420,
    min: 320,
    max: 640,
  });
  const maximum = Math.min(
    constraint.max,
    available - DEFAULT_MIN_NATIVE_WIDTH,
  );
  if (maximum < constraint.min) {
    return fallback(
      requested,
      configuration,
      geometry,
      "The right panel cannot satisfy both application and DSH minimum widths",
    );
  }
  const panelWidth = clamp(
    preferred ?? constraint.initial,
    constraint.min,
    maximum,
  );
  const nativeWidth = available - panelWidth;
  return {
    requested,
    resolved: "right-panel",
    bounds: {
      top: 0,
      right: geometry.detailsWidth,
      bottom: 0,
      left: geometry.sidebarWidth + nativeWidth,
    },
    nativePane: {
      width: nativeWidth,
      justifySelf: "start",
      borderLeft: true,
    },
    ...(configuration.resizable === false
      ? {}
      : {
          resize: {
            key: "rightPanel" as const,
            edge: "left" as const,
            orientation: "vertical" as const,
            value: panelWidth,
            min: constraint.min,
            max: maximum,
          },
        }),
  };
}

function bottomPanel(
  requested: ReactSurfaceLayout,
  configuration: ReactSurfaceLayoutConfiguration,
  geometry: ReactSurfaceShellGeometry,
  preferred: number | undefined,
): ReactSurfaceLayoutResolution {
  const minSurface =
    configuration.minSurfaceHeight ?? DEFAULT_MIN_SURFACE_HEIGHT;
  const constraint = normalizeConstraint(configuration.bottomPanel, {
    initial: 320,
    min: Math.max(220, minSurface),
    max: 520,
  });
  const maximum = Math.min(
    constraint.max,
    geometry.height - DEFAULT_MIN_NATIVE_HEIGHT,
  );
  if (maximum < constraint.min) {
    return fallback(
      requested,
      configuration,
      geometry,
      "The bottom panel cannot satisfy both application and DSH minimum heights",
    );
  }
  const panelHeight = clamp(
    preferred ?? constraint.initial,
    constraint.min,
    maximum,
  );
  const nativeHeight = geometry.height - panelHeight;
  return {
    requested,
    resolved: "bottom-panel",
    bounds: {
      top: nativeHeight,
      right: geometry.detailsWidth,
      bottom: 0,
      left: geometry.sidebarWidth,
    },
    nativePane: {
      height: nativeHeight,
      alignSelf: "start",
      borderTop: true,
    },
    ...(configuration.resizable === false
      ? {}
      : {
          resize: {
            key: "bottomPanel" as const,
            edge: "top" as const,
            orientation: "horizontal" as const,
            value: panelHeight,
            min: constraint.min,
            max: maximum,
          },
        }),
  };
}

function fallback(
  requested: ReactSurfaceLayout,
  configuration: ReactSurfaceLayoutConfiguration,
  geometry: ReactSurfaceShellGeometry,
  reason: string,
): ReactSurfaceLayoutResolution {
  return configuration.fallback === "center"
    ? center(requested, configuration, geometry, reason)
    : fullFrame(requested, reason);
}

function normalizeConstraint(
  candidate: ReactSurfaceSizeConstraint | undefined,
  fallbackValue: Required<ReactSurfaceSizeConstraint>,
): Required<ReactSurfaceSizeConstraint> {
  const min = candidate?.min ?? fallbackValue.min;
  const max = Math.max(min, candidate?.max ?? fallbackValue.max);
  return {
    min,
    max,
    initial: clamp(candidate?.initial ?? fallbackValue.initial, min, max),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
