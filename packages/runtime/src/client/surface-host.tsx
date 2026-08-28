import {
  Component,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createPortal } from "react-dom";

import type {
  ReactSurfaceDefinition,
  ReactSurfaceRegistry,
} from "./contracts.ts";

const BASE_SURFACE_STYLES = `
:host {
  all: initial;
  color-scheme: light dark;
  contain: strict;
  display: block;
  height: 100%;
  width: 100%;
}
:host([hidden]) {
  display: none;
}
*, *::before, *::after {
  box-sizing: border-box;
}
#dsh-react-surface-root {
  height: 100%;
  width: 100%;
}
`;

interface ReactSurfaceHostProps {
  registry: ReactSurfaceRegistry;
}

export function ReactSurfaceHost({ registry }: ReactSurfaceHostProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const snapshot = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  );

  useEffect(() => {
    if (snapshot.activeId === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) registry.close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [registry, snapshot.activeId]);

  useEffect(() => {
    if (snapshot.activeId === null) return;
    const overlay = layerRef.current?.closest("[data-shell-overlay]");
    const frame = overlay?.parentElement;
    if (!(overlay instanceof HTMLElement) || !frame) return;

    const siblings = Array.from(frame.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== overlay,
    );
    const previous = siblings.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));

    for (const element of siblings) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }

    return () => {
      for (const state of previous) {
        state.element.inert = state.inert;
        if (state.ariaHidden === null)
          state.element.removeAttribute("aria-hidden");
        else state.element.setAttribute("aria-hidden", state.ariaHidden);
      }
    };
  }, [snapshot.activeId]);

  return (
    <div
      ref={layerRef}
      data-dsh-react-surface-layer=""
      aria-hidden={snapshot.activeId === null}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: snapshot.activeId === null ? "none" : "auto",
      }}
    >
      {snapshot.surfaces.map(({ definition, location }) => (
        <ShadowSurface
          key={definition.id}
          definition={definition}
          location={location}
          active={snapshot.activeId === definition.id}
          registry={registry}
        />
      ))}
    </div>
  );
}

interface ShadowSurfaceProps {
  definition: Readonly<ReactSurfaceDefinition>;
  location: string;
  active: boolean;
  registry: ReactSurfaceRegistry;
}

function ShadowSurface({
  definition,
  location,
  active,
  registry,
}: ShadowSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [portalRoot, setPortalRoot] = useState<ShadowRoot | null>(null);

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
      <div role="alert" style={{ padding: 24, fontFamily: "system-ui" }}>
        <strong>{this.props.title} could not be rendered.</strong>
      </div>
    );
  }
}
