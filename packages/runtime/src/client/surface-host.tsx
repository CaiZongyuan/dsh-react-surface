import {
  Component,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  ErrorInfo,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { createPortal } from "react-dom";

import {
  getReactSurfaceLayoutConfiguration,
  type ReactSurfaceDefinition,
} from "./contracts.ts";
import {
  activateDshShell,
  type DshShellActivation,
} from "./dsh-host-adapter.ts";
import type {
  ReactSurfaceLayoutResolution,
  ReactSurfaceResizeDescriptor,
} from "./layout-engine.ts";
import type { ReactSurfaceRegistryImpl } from "./registry.ts";

const BASE_SURFACE_STYLES = `
:host {
  all: initial;
  color-scheme: light dark;
  contain: strict;
  container-name: dsh-react-surface;
  container-type: inline-size;
  display: block;
  height: 100%;
  width: 100%;
  --dsh-surface-background: var(--dsw-alias-bg-base, #f7f8fa);
  --dsh-surface-surface: var(--dsw-alias-bg-layer-1, #ffffff);
  --dsh-surface-elevated: var(--dsw-alias-bg-layer-2, #f2f3f5);
  --dsh-surface-foreground: var(--dsw-alias-label-primary, #252730);
  --dsh-surface-muted-foreground: var(--dsw-alias-label-secondary, #6b7280);
  --dsh-surface-border: var(--dsw-alias-border-l2, #dfe3e8);
  --dsh-surface-accent: var(--dsw-alias-brand-primary, #2367d1);
  --dsh-surface-accent-foreground: var(--dsw-alias-brand-primary-invert, #fff);
  --dsh-surface-font-family: var(--dsw-font-family, Inter, ui-sans-serif, system-ui, sans-serif);
  --dsh-surface-radius: 6px;
}
:host([hidden]) {
  display: none;
}
*, *::before, *::after {
  box-sizing: border-box;
}
#dsh-react-surface-root {
  background: var(--dsh-surface-background);
  color: var(--dsh-surface-foreground);
  container-name: dsh-react-surface-content;
  container-type: inline-size;
  font-family: var(--dsh-surface-font-family);
  height: 100%;
  width: 100%;
}
`;

interface ReactSurfaceHostProps {
  registry: ReactSurfaceRegistryImpl;
}

interface DragState {
  pointerId: number;
  startCoordinate: number;
  startValue: number;
  currentValue: number;
  resize: ReactSurfaceResizeDescriptor;
}

export function ReactSurfaceHost({ registry }: ReactSurfaceHostProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const activationRef = useRef<DshShellActivation | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [resolution, setResolution] =
    useState<ReactSurfaceLayoutResolution | null>(null);
  const snapshot = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  );
  const activeSurface = snapshot.surfaces.find(
    ({ definition }) => definition.id === snapshot.activeId,
  );
  const activeId = activeSurface?.definition.id ?? null;
  const activeLayout = activeSurface?.layout ?? null;
  const activeDefinition = activeSurface?.definition;

  useEffect(() => {
    if (activeId === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        document.querySelector("[data-dsh-react-surface-menu-backdrop]") ===
          null
      ) {
        registry.close();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeId, registry]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer || !activeDefinition || !activeLayout) {
      activationRef.current = null;
      registry.setShellDiagnostics({
        compatible: true,
        requestedLayout: null,
        resolvedLayout: null,
      });
      return;
    }
    const activation = activateDshShell({
      surfaceId: activeDefinition.id,
      layer,
      requestedLayout: activeLayout,
      configuration: getReactSurfaceLayoutConfiguration(activeDefinition),
      ...(activeDefinition.branding === undefined
        ? {}
        : { branding: activeDefinition.branding }),
      preferences: registry.preferences,
      onResolution: (next) => {
        setResolution((current) =>
          sameResolution(current, next) ? current : next,
        );
        registry.setShellDiagnostics({
          compatible: !next.reason?.startsWith("DSH shell elements"),
          requestedLayout: next.requested,
          resolvedLayout: next.resolved,
          ...(next.reason === undefined ? {} : { reason: next.reason }),
        });
      },
    });
    activationRef.current = activation;
    return () => {
      dragRef.current = null;
      activationRef.current = null;
      activation.dispose();
    };
  }, [activeDefinition, activeLayout, registry]);

  const resize = activeId === null ? undefined : resolution?.resize;

  return (
    <div
      ref={layerRef}
      data-dsh-react-surface-layer=""
      aria-hidden={activeId === null}
      style={{
        position: "absolute",
        overflow: "hidden",
        pointerEvents: activeId === null ? "none" : "auto",
      }}
    >
      {snapshot.surfaces
        .filter(({ mounted }) => mounted)
        .map(({ definition, layout, location }) => (
          <ShadowSurface
            key={definition.id}
            definition={definition}
            location={location}
            layout={layout}
            active={activeId === definition.id}
            registry={registry}
          />
        ))}
      {resize ? (
        <SurfaceResizeHandle
          resize={resize}
          dragRef={dragRef}
          onResize={(key, value) =>
            activationRef.current?.setPanelSize(key, value)
          }
          onCommit={(key, value) =>
            activationRef.current?.setPanelSize(key, value, true)
          }
        />
      ) : null}
    </div>
  );
}

interface SurfaceResizeHandleProps {
  resize: ReactSurfaceResizeDescriptor;
  dragRef: React.MutableRefObject<DragState | null>;
  onResize(key: ReactSurfaceResizeDescriptor["key"], value: number): void;
  onCommit(key: ReactSurfaceResizeDescriptor["key"], value: number): void;
}

function SurfaceResizeHandle({
  resize,
  dragRef,
  onResize,
  onCommit,
}: SurfaceResizeHandleProps) {
  const vertical = resize.orientation === "vertical";
  const edgeStyle =
    resize.edge === "left"
      ? { left: -4, top: 0, bottom: 0, width: 8 }
      : resize.edge === "right"
        ? { right: -4, top: 0, bottom: 0, width: 8 }
        : { top: -4, right: 0, left: 0, height: 8 };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startCoordinate: vertical ? event.clientX : event.clientY,
      startValue: resize.value,
      currentValue: resize.value,
      resize,
    };
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const coordinate = vertical ? event.clientX : event.clientY;
    const value = clamp(
      drag.startValue - (coordinate - drag.startCoordinate),
      drag.resize.min,
      drag.resize.max,
    );
    drag.currentValue = value;
    onResize(drag.resize.key, value);
  };
  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    const drag = dragRef.current;
    onCommit(drag.resize.key, drag.currentValue);
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const increase = vertical
      ? event.key === "ArrowLeft"
      : event.key === "ArrowUp";
    const decrease = vertical
      ? event.key === "ArrowRight"
      : event.key === "ArrowDown";
    if (!increase && !decrease) return;
    event.preventDefault();
    onCommit(
      resize.key,
      clamp(resize.value + (increase ? 16 : -16), resize.min, resize.max),
    );
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label="Resize React Surface layout"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-valuemin={resize.min}
      aria-valuemax={resize.max}
      aria-valuenow={resize.value}
      data-dsh-react-surface-resize={resize.edge}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      style={{
        ...edgeStyle,
        cursor: vertical ? "col-resize" : "row-resize",
        outline: "none",
        position: "absolute",
        touchAction: "none",
        zIndex: 2,
      }}
    />
  );
}

interface ShadowSurfaceProps {
  definition: Readonly<ReactSurfaceDefinition>;
  location: string;
  layout: import("./contracts.ts").ReactSurfaceLayout;
  active: boolean;
  registry: ReactSurfaceRegistryImpl;
}

function ShadowSurface({
  definition,
  location,
  layout,
  active,
  registry,
}: ShadowSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [portalRoot, setPortalRoot] = useState<ShadowRoot | null>(null);
  const [agent] = useState(
    () =>
      ({
        register: (registration) =>
          registry.registerAgent(definition.id, registration),
      }) satisfies import("./contracts.ts").ReactSurfaceAgentController,
  );

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    setPortalRoot(root);
  }, []);

  useEffect(() => {
    if (hostRef.current) hostRef.current.inert = !active;
  }, [active]);

  const Surface = definition.component;

  return (
    <div
      ref={hostRef}
      data-surface-id={definition.id}
      data-surface-layout={layout}
      hidden={!active}
      style={{ position: "absolute", inset: 0 }}
    >
      {portalRoot
        ? createPortal(
            <>
              <style>{`${BASE_SURFACE_STYLES}\n${definition.styles ?? ""}`}</style>
              <SurfaceErrorBoundary title={definition.title}>
                <div id="dsh-react-surface-root">
                  <Surface
                    active={active}
                    agent={agent}
                    capabilities={registry.getSnapshot().runtime.capabilities}
                    layout={layout}
                    location={location}
                    portalRoot={portalRoot}
                    close={() => registry.close()}
                    navigate={(nextLocation) =>
                      registry.open(definition.id, nextLocation)
                    }
                  />
                </div>
              </SurfaceErrorBoundary>
            </>,
            portalRoot,
          )
        : null}
    </div>
  );
}

interface SurfaceErrorBoundaryProps {
  title: string;
  children: ReactNode;
}

interface SurfaceErrorBoundaryState {
  error: Error | null;
}

class SurfaceErrorBoundary extends Component<
  SurfaceErrorBoundaryProps,
  SurfaceErrorBoundaryState
> {
  override state: SurfaceErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): SurfaceErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`React surface crashed: ${this.props.title}`, error, info);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          alignContent: "center",
          background: "var(--dsh-surface-background)",
          color: "var(--dsh-surface-foreground)",
          display: "grid",
          gap: 12,
          height: "100%",
          justifyItems: "center",
          padding: 24,
        }}
      >
        <strong>{this.props.title} could not be rendered.</strong>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          style={{
            background: "var(--dsh-surface-accent)",
            border: 0,
            borderRadius: "var(--dsh-surface-radius)",
            color: "var(--dsh-surface-accent-foreground)",
            cursor: "pointer",
            font: "inherit",
            minHeight: 34,
            padding: "0 14px",
          }}
        >
          Retry
        </button>
      </div>
    );
  }
}

function sameResolution(
  left: ReactSurfaceLayoutResolution | null,
  right: ReactSurfaceLayoutResolution,
): boolean {
  return left !== null && JSON.stringify(left) === JSON.stringify(right);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
