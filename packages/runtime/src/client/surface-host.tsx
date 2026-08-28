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
import { resolveWorkspaceLayout } from "./workspace-layout.ts";

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

interface ShellFrameElements {
  frame: HTMLElement;
  overlay: HTMLElement;
  sidebar: HTMLElement;
  conversation: HTMLElement;
  details: HTMLElement | null;
}

interface WorkspaceBounds {
  left: number;
  right: number;
}

function getShellFrameElements(
  layer: HTMLDivElement | null,
): ShellFrameElements | null {
  const overlay = layer?.closest("[data-shell-overlay]");
  const frame = overlay?.parentElement;
  const sidebar = frame?.firstElementChild;
  const frameChildren = frame
    ? Array.from(frame.children).filter(
        (element): element is HTMLElement => element instanceof HTMLElement,
      )
    : [];
  const conversationPane = frame?.querySelector('[data-pane="conversation"]');
  let conversation =
    conversationPane instanceof HTMLElement
      ? directFrameChild(conversationPane, frame ?? null)
      : null;
  conversation ??= frameChildren[1] ?? null;
  const details = frameChildren[2] ?? null;
  if (
    !(overlay instanceof HTMLElement) ||
    !(frame instanceof HTMLElement) ||
    !(sidebar instanceof HTMLElement) ||
    !(conversation instanceof HTMLElement) ||
    sidebar === overlay
  ) {
    return null;
  }
  return { frame, overlay, sidebar, conversation, details };
}

function directFrameChild(element: HTMLElement, frame: Element | null) {
  let current: HTMLElement | null = element;
  while (current && current.parentElement !== frame)
    current = current.parentElement;
  return current;
}

export function ReactSurfaceHost({ registry }: ReactSurfaceHostProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [workspaceBounds, setWorkspaceBounds] =
    useState<WorkspaceBounds | null>(null);
  const snapshot = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  );
  const activeSurface = snapshot.surfaces.find(
    ({ definition }) => definition.id === snapshot.activeId,
  );
  const wantsWorkspace = activeSurface?.definition.layout === "workspace";
  const workspaceActive = wantsWorkspace && workspaceBounds !== null;

  useEffect(() => {
    if (snapshot.activeId === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) registry.close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [registry, snapshot.activeId]);

  useLayoutEffect(() => {
    if (!wantsWorkspace) {
      setWorkspaceBounds(null);
      return;
    }

    const elements = getShellFrameElements(layerRef.current);
    if (!elements) return;
    const { frame, overlay, sidebar, conversation, details } = elements;
    const previousConversationStyle = conversation.getAttribute("style");
    const previousFrameLayout = frame.getAttribute("data-react-surface-layout");

    const restoreFrame = () => {
      if (previousConversationStyle === null)
        conversation.removeAttribute("style");
      else conversation.setAttribute("style", previousConversationStyle);
      if (previousFrameLayout === null)
        frame.removeAttribute("data-react-surface-layout");
      else frame.setAttribute("data-react-surface-layout", previousFrameLayout);
    };

    const updateLayout = () => {
      const frameRect = frame.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();
      const sidebarRect = sidebar.getBoundingClientRect();
      const detailsWidth = details?.getBoundingClientRect().width ?? 0;
      const columns = resolveWorkspaceLayout({
        frameWidth: frameRect.width - detailsWidth,
        sidebarWidth: sidebarRect.width,
      });

      if (!columns) {
        restoreFrame();
        setWorkspaceBounds(null);
        return;
      }

      conversation.style.width = `${columns.conversationWidth}px`;
      conversation.style.minWidth = "0";
      conversation.style.justifySelf = "end";
      conversation.style.borderLeft =
        "1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.08))";
      frame.setAttribute("data-react-surface-layout", "workspace");

      const conversationRect = conversation.getBoundingClientRect();
      const nextBounds = {
        left: Math.max(0, sidebarRect.right - overlayRect.left),
        right: Math.max(0, overlayRect.right - conversationRect.left),
      };
      setWorkspaceBounds((current) =>
        current?.left === nextBounds.left && current.right === nextBounds.right
          ? current
          : nextBounds,
      );
    };

    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    const mutationObserver = new MutationObserver(updateLayout);
    observer.observe(frame);
    observer.observe(overlay);
    observer.observe(sidebar);
    if (details) observer.observe(details);
    mutationObserver.observe(frame, {
      attributes: true,
      attributeFilter: ["style"],
    });
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      restoreFrame();
      setWorkspaceBounds(null);
    };
  }, [wantsWorkspace]);

  useEffect(() => {
    if (snapshot.activeId === null) return;
    const elements = getShellFrameElements(layerRef.current);
    if (!elements) return;
    const { frame, overlay } = elements;

    const siblings = Array.from(frame.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element !== overlay &&
        !workspaceActive,
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
  }, [snapshot.activeId, workspaceActive]);

  return (
    <div
      ref={layerRef}
      data-dsh-react-surface-layer=""
      data-surface-layout={workspaceActive ? "workspace" : "full-frame"}
      aria-hidden={snapshot.activeId === null}
      style={{
        position: "absolute",
        top: 0,
        right: workspaceActive ? workspaceBounds.right : 0,
        bottom: 0,
        left: workspaceActive ? workspaceBounds.left : 0,
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
