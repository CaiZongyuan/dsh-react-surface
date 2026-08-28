import type { ComponentType } from "react";

export interface ReactSurfaceProps {
  /** Whether this surface is currently covering the DSH workspace. */
  active: boolean;
  /** Application-owned location retained while the surface is hidden. */
  location: string;
  /** Portal target inside this surface's isolated ShadowRoot. */
  portalRoot: ShadowRoot;
  /** Return to the native DSH workspace without unmounting this application. */
  close(): void;
  /** Change this surface's application-owned location. */
  navigate(location: string): void;
}

export interface ReactSurfaceDefinition {
  /** Stable package-wide identifier. */
  id: string;
  /** User-facing application name. */
  title: string;
  /** React application root rendered with DSH's shared React runtime. */
  component: ComponentType<ReactSurfaceProps>;
  /** CSS text installed only inside this application's ShadowRoot. */
  styles?: string;
  /** Lower values appear first in the DSH launcher. */
  order?: number;
  /** Initial application-owned location. */
  initialLocation?: string;
}

export interface RegisteredReactSurface {
  readonly definition: Readonly<ReactSurfaceDefinition>;
  readonly location: string;
}

export interface ReactSurfaceSnapshot {
  readonly activeId: string | null;
  readonly surfaces: readonly RegisteredReactSurface[];
}

export interface ReactSurfaceRegistry {
  /** Register one application for the lifetime of its owning DSH plugin. */
  register(definition: ReactSurfaceDefinition): () => void;
  /** Show a registered application, optionally replacing its location. */
  open(id: string, location?: string): void;
  /** Reveal the native DSH workspace while preserving application state. */
  close(): void;
  /** Navigate the currently active application. */
  navigate(location: string): void;
  /** Stable external-store snapshot for React and non-React consumers. */
  getSnapshot(): ReactSurfaceSnapshot;
  /** Observe registry, visibility, and location changes. */
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
}
