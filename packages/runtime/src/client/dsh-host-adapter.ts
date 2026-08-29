import type {
  ReactSurfaceBranding,
  ReactSurfaceLayout,
  ReactSurfaceLayoutConfiguration,
} from "./contracts.ts";
import { ReactSurfaceEffectLedger } from "./effect-ledger.ts";
import {
  resolveReactSurfaceLayout,
  type ReactSurfaceLayoutResolution,
} from "./layout-engine.ts";
import { buildSurfaceBrandDeclarations } from "./shell-branding.ts";
import type {
  ReactSurfacePanelSize,
  ReactSurfacePreferenceStore,
} from "./surface-preferences.ts";

interface ShellElements {
  frame: HTMLElement;
  overlay: HTMLElement;
  sidebar: HTMLElement;
  conversation: HTMLElement;
  details: HTMLElement | null;
}

export interface DshShellActivationOptions {
  surfaceId: string;
  layer: HTMLDivElement;
  requestedLayout: ReactSurfaceLayout;
  configuration: ReactSurfaceLayoutConfiguration;
  branding?: ReactSurfaceBranding;
  preferences: ReactSurfacePreferenceStore;
  onResolution(resolution: ReactSurfaceLayoutResolution): void;
}

export interface DshShellActivation {
  setPanelSize(
    key: ReactSurfacePanelSize,
    value: number,
    persist?: boolean,
  ): void;
  dispose(): void;
}

/** Own every DSH DOM effect created by one active Surface. */
export function activateDshShell({
  surfaceId,
  layer,
  requestedLayout,
  configuration,
  branding,
  preferences,
  onResolution,
}: DshShellActivationOptions): DshShellActivation {
  const ledger = new ReactSurfaceEffectLedger();
  const activationId = ledger.begin();
  const layerPatch = new OwnedElementPatch(layer);
  let shellPatch: ShellPatch | undefined;
  let elements: ShellElements | null = null;
  let resizeObserver: ResizeObserver | undefined;
  let mutationObserver: MutationObserver | undefined;
  let animationFrame = 0;
  let disposed = false;
  let lastResolutionKey = "";
  const transientSizes = { ...preferences.get(surfaceId).sizes };

  applyBrand(layerPatch, branding, false);
  layerPatch.setAttribute("data-dsh-react-surface-active", surfaceId);
  ledger.record(activationId, () => layerPatch.dispose());

  const update = () => {
    animationFrame = 0;
    if (disposed) return;
    const nextElements = locateShellElements(layer);
    if (!sameShellElements(elements, nextElements)) {
      shellPatch?.dispose();
      shellPatch = undefined;
      elements = nextElements;
      resizeObserver?.disconnect();
      if (elements) {
        shellPatch = new ShellPatch(elements);
        resizeObserver?.observe(elements.frame);
        resizeObserver?.observe(elements.overlay);
        resizeObserver?.observe(elements.sidebar);
        resizeObserver?.observe(elements.conversation);
        if (elements.details) resizeObserver?.observe(elements.details);
      }
    }

    const resolution = elements
      ? resolveForElements(elements)
      : unavailableResolution(requestedLayout);
    shellPatch?.apply(resolution, surfaceId, branding);
    layerPatch.setAttribute("data-surface-layout", resolution.resolved);
    applyBounds(layerPatch, resolution);

    const resolutionKey = JSON.stringify(resolution);
    if (resolutionKey !== lastResolutionKey) {
      lastResolutionKey = resolutionKey;
      onResolution(resolution);
    }
  };

  const scheduleUpdate = () => {
    if (disposed || animationFrame !== 0) return;
    animationFrame = requestAnimationFrame(update);
  };

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(scheduleUpdate);
    ledger.record(activationId, () => resizeObserver?.disconnect());
  }
  const initialFrame = layer.closest("[data-shell-overlay]")?.parentElement;
  if (typeof MutationObserver !== "undefined" && initialFrame) {
    mutationObserver = new MutationObserver(scheduleUpdate);
    mutationObserver.observe(initialFrame, {
      attributes: true,
      attributeFilter: ["data-pane", "style"],
      childList: true,
      subtree: true,
    });
    ledger.record(activationId, () => mutationObserver?.disconnect());
  }
  const unsubscribePreferences = preferences.subscribe(scheduleUpdate);
  ledger.record(activationId, unsubscribePreferences);
  ledger.record(activationId, () => shellPatch?.dispose());
  ledger.record(activationId, () => {
    if (animationFrame !== 0) cancelAnimationFrame(animationFrame);
  });

  update();

  return {
    setPanelSize(key, value, persist = false) {
      transientSizes[key] = value;
      if (persist && configuration.persist !== false) {
        preferences.setSize(surfaceId, key, value);
        delete transientSizes[key];
      }
      scheduleUpdate();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ledger.dispose(activationId);
    },
  };

  function resolveForElements(
    shell: ShellElements,
  ): ReactSurfaceLayoutResolution {
    const overlayRect = shell.overlay.getBoundingClientRect();
    const sidebarRect = shell.sidebar.getBoundingClientRect();
    const detailsRect = shell.details?.getBoundingClientRect();
    return resolveReactSurfaceLayout({
      requested: requestedLayout,
      configuration,
      geometry: {
        width: overlayRect.width,
        height: overlayRect.height,
        sidebarWidth: Math.max(0, sidebarRect.right - overlayRect.left),
        detailsWidth: detailsRect?.width ?? 0,
      },
      preferredSizes: {
        ...preferences.get(surfaceId).sizes,
        ...transientSizes,
      },
    });
  }
}

function locateShellElements(layer: HTMLElement): ShellElements | null {
  const overlay = layer.closest("[data-shell-overlay]");
  const frame = overlay?.parentElement;
  if (!(overlay instanceof HTMLElement) || !(frame instanceof HTMLElement)) {
    return null;
  }
  const contentChildren = Array.from(frame.children).filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && element !== overlay,
  );
  const sidebarPane = frame.querySelector('[data-pane="sidebar"]');
  const conversationPane = frame.querySelector('[data-pane="conversation"]');
  const detailsPane = frame.querySelector('[data-pane="details"]');
  const sidebar =
    directFrameChild(sidebarPane, frame) ?? contentChildren.at(0) ?? null;
  const conversation =
    directFrameChild(conversationPane, frame) ?? contentChildren.at(1) ?? null;
  const details =
    directFrameChild(detailsPane, frame) ??
    contentChildren.find(
      (element) => element !== sidebar && element !== conversation,
    ) ??
    null;
  if (!sidebar || !conversation) return null;
  return { frame, overlay, sidebar, conversation, details };
}

function directFrameChild(
  element: Element | null,
  frame: HTMLElement,
): HTMLElement | null {
  let current = element instanceof HTMLElement ? element : null;
  while (current && current.parentElement !== frame) {
    current = current.parentElement;
  }
  return current;
}

function sameShellElements(
  left: ShellElements | null,
  right: ShellElements | null,
): boolean {
  return (
    left?.frame === right?.frame &&
    left?.overlay === right?.overlay &&
    left?.sidebar === right?.sidebar &&
    left?.conversation === right?.conversation &&
    left?.details === right?.details
  );
}

function unavailableResolution(
  requested: ReactSurfaceLayout,
): ReactSurfaceLayoutResolution {
  return {
    requested,
    resolved: "full-frame",
    bounds: { top: 0, right: 0, bottom: 0, left: 0 },
    nativePane: {},
    reason:
      requested === "full-frame"
        ? "DSH shell elements are unavailable; the overlay remains isolated"
        : "DSH shell elements are unavailable; split layout was disabled",
  };
}

function applyBounds(
  patch: OwnedElementPatch,
  resolution: ReactSurfaceLayoutResolution,
): void {
  patch.setStyle("top", `${resolution.bounds.top}px`);
  patch.setStyle("right", `${resolution.bounds.right}px`);
  patch.setStyle("bottom", `${resolution.bounds.bottom}px`);
  patch.setStyle("left", `${resolution.bounds.left}px`);
}

class ShellPatch {
  readonly #frame: OwnedElementPatch;
  readonly #conversation: OwnedElementPatch;
  readonly #inert = new Map<HTMLElement, OwnedElementPatch>();

  constructor(private readonly elements: ShellElements) {
    this.#frame = new OwnedElementPatch(elements.frame);
    this.#conversation = new OwnedElementPatch(elements.conversation);
  }

  apply(
    resolution: ReactSurfaceLayoutResolution,
    surfaceId: string,
    branding: ReactSurfaceBranding | undefined,
  ): void {
    this.#frame.setAttribute("data-dsh-react-surface-active", surfaceId);
    this.#frame.setAttribute(
      "data-dsh-react-surface-layout",
      resolution.resolved,
    );
    applyBrand(this.#frame, branding, branding?.shell === "surface");

    const pane = resolution.nativePane;
    this.#conversation.setStyle(
      "width",
      pane.width === undefined ? undefined : `${pane.width}px`,
    );
    this.#conversation.setStyle(
      "height",
      pane.height === undefined ? undefined : `${pane.height}px`,
    );
    this.#conversation.setStyle("min-width", pane.width ? "0" : undefined);
    this.#conversation.setStyle("min-height", pane.height ? "0" : undefined);
    this.#conversation.setStyle("justify-self", pane.justifySelf);
    this.#conversation.setStyle("align-self", pane.alignSelf);
    this.#conversation.setStyle(
      "border-left",
      pane.borderLeft
        ? "1px solid var(--dsh-surface-border, var(--dsw-alias-border-l1, rgba(0,0,0,.12)))"
        : undefined,
    );
    this.#conversation.setStyle(
      "border-top",
      pane.borderTop
        ? "1px solid var(--dsh-surface-border, var(--dsw-alias-border-l1, rgba(0,0,0,.12)))"
        : undefined,
    );

    const inertElements =
      resolution.resolved === "full-frame"
        ? [
            this.elements.sidebar,
            this.elements.conversation,
            ...(this.elements.details ? [this.elements.details] : []),
          ]
        : resolution.resolved === "center"
          ? [
              this.elements.conversation,
              ...(this.elements.details ? [this.elements.details] : []),
            ]
          : [];
    const nextInert = new Set(inertElements);
    for (const [element, patch] of this.#inert) {
      if (nextInert.has(element)) continue;
      patch.dispose();
      this.#inert.delete(element);
    }
    for (const element of nextInert) {
      let patch = this.#inert.get(element);
      if (!patch) {
        patch = new OwnedElementPatch(element);
        this.#inert.set(element, patch);
      }
      patch.setInert(true);
      patch.setAttribute("aria-hidden", "true");
    }
  }

  dispose(): void {
    for (const patch of this.#inert.values()) patch.dispose();
    this.#inert.clear();
    this.#conversation.dispose();
    this.#frame.dispose();
  }
}

function applyBrand(
  patch: OwnedElementPatch,
  branding: ReactSurfaceBranding | undefined,
  includeShellAliases: boolean,
): void {
  const source = includeShellAliases
    ? branding
    : branding === undefined
      ? undefined
      : { ...branding, shell: "preserve" as const };
  for (const [name, value] of buildSurfaceBrandDeclarations(source)) {
    patch.setStyle(name, value);
  }
  const scheme = branding?.colorScheme;
  patch.setStyle(
    "color-scheme",
    scheme === undefined || scheme === "system" ? undefined : scheme,
  );
  patch.setAttribute(
    "data-dsh-react-surface-brand",
    includeShellAliases && branding?.shell === "surface"
      ? "surface"
      : undefined,
  );
}

interface OwnedStyleValue {
  readonly previous: string;
  readonly previousPriority: string;
  applied: string | undefined;
}

interface OwnedAttributeValue {
  readonly previous: string | null;
  applied: string | undefined;
}

class OwnedElementPatch {
  readonly #styles = new Map<string, OwnedStyleValue>();
  readonly #attributes = new Map<string, OwnedAttributeValue>();
  #inert: { previous: boolean; applied: boolean } | undefined;
  #disposed = false;

  constructor(private readonly element: HTMLElement) {}

  setStyle(name: string, value: string | undefined): void {
    if (this.#disposed) return;
    let state = this.#styles.get(name);
    if (!state) {
      state = {
        previous: this.element.style.getPropertyValue(name),
        previousPriority: this.element.style.getPropertyPriority(name),
        applied: undefined,
      };
      this.#styles.set(name, state);
    }
    if (state.applied === value) return;
    state.applied = value;
    if (value === undefined) {
      restoreStyle(this.element, name, state.previous, state.previousPriority);
    } else {
      this.element.style.setProperty(name, value);
    }
  }

  setAttribute(name: string, value: string | undefined): void {
    if (this.#disposed) return;
    let state = this.#attributes.get(name);
    if (!state) {
      state = { previous: this.element.getAttribute(name), applied: undefined };
      this.#attributes.set(name, state);
    }
    if (state.applied === value) return;
    state.applied = value;
    if (value === undefined)
      restoreAttribute(this.element, name, state.previous);
    else this.element.setAttribute(name, value);
  }

  setInert(value: boolean): void {
    if (this.#disposed) return;
    this.#inert ??= { previous: this.element.inert, applied: value };
    this.#inert.applied = value;
    this.element.inert = value;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const [name, state] of this.#styles) {
      if (
        state.applied === undefined ||
        this.element.style.getPropertyValue(name) === state.applied
      ) {
        restoreStyle(
          this.element,
          name,
          state.previous,
          state.previousPriority,
        );
      }
    }
    for (const [name, state] of this.#attributes) {
      if (
        state.applied === undefined ||
        this.element.getAttribute(name) === state.applied
      ) {
        restoreAttribute(this.element, name, state.previous);
      }
    }
    if (this.#inert && this.element.inert === this.#inert.applied) {
      this.element.inert = this.#inert.previous;
    }
  }
}

function restoreStyle(
  element: HTMLElement,
  name: string,
  value: string,
  priority: string,
): void {
  if (value) element.style.setProperty(name, value, priority);
  else element.style.removeProperty(name);
}

function restoreAttribute(
  element: HTMLElement,
  name: string,
  value: string | null,
): void {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}
