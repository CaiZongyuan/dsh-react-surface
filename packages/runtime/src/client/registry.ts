import type {
  ReactSurfaceAgentCapability,
  ReactSurfaceAgentRegistration,
  ReactSurfaceDefinition,
  ReactSurfaceDiagnostics,
  ReactSurfaceLayout,
  ReactSurfaceRegistry,
  ReactSurfaceRuntimeSnapshot,
  ReactSurfaceShellDiagnostics,
  ReactSurfaceSnapshot,
  RegisteredReactSurface,
} from "./contracts.ts";
import { getBundledSurfaceStyles } from "./built-styles.ts";
import {
  defineReactSurface,
  getReactSurfaceLayoutConfiguration,
} from "./contracts.ts";
import {
  REACT_SURFACE_FEATURES,
  REACT_SURFACE_INTERFACE_VERSION,
  REACT_SURFACE_RUNTIME_VERSION,
} from "./runtime-metadata.ts";
import { ReactSurfacePreferenceStore } from "./surface-preferences.ts";

const INITIAL_AGENT_CAPABILITY: ReactSurfaceAgentCapability = Object.freeze({
  available: false,
  status: "unavailable",
  reason: "dsh-ag-ui availability has not been detected",
});
const INITIAL_SHELL_DIAGNOSTICS: ReactSurfaceShellDiagnostics = Object.freeze({
  compatible: true,
  requestedLayout: null,
  resolvedLayout: null,
});

export class ReactSurfaceRegistryImpl implements ReactSurfaceRegistry {
  readonly version = REACT_SURFACE_RUNTIME_VERSION;
  readonly features = REACT_SURFACE_FEATURES;
  readonly #definitions = new Map<string, Readonly<ReactSurfaceDefinition>>();
  readonly #locations = new Map<string, string>();
  readonly #layouts = new Map<string, ReactSurfaceLayout>();
  readonly #mounted = new Set<string>();
  readonly #agents = new Map<string, ReactSurfaceAgentRegistration>();
  readonly #listeners = new Set<() => void>();
  readonly #preferences: ReactSurfacePreferenceStore;
  readonly #unsubscribePreferences: () => void;
  #activeId: string | null = null;
  #agentCapability = INITIAL_AGENT_CAPABILITY;
  #shellDiagnostics = INITIAL_SHELL_DIAGNOSTICS;
  #snapshot: ReactSurfaceSnapshot;

  constructor(preferences = new ReactSurfacePreferenceStore()) {
    this.#preferences = preferences;
    this.#snapshot = this.#createSnapshot();
    this.#unsubscribePreferences = preferences.subscribe(() =>
      this.#syncPersistedLayouts(),
    );
  }

  register(definition: ReactSurfaceDefinition): () => void {
    const bundledStyles = getBundledSurfaceStyles(definition.id);
    const normalized = defineReactSurface(
      bundledStyles === undefined
        ? definition
        : {
            ...definition,
            styles: [bundledStyles, definition.styles]
              .filter((value): value is string => value !== undefined)
              .join("\n"),
          },
    );
    if (this.#definitions.has(normalized.id)) {
      throw new Error(`React surface is already registered: ${normalized.id}`);
    }

    const layout = getReactSurfaceLayoutConfiguration(normalized);
    const preferredLayout = this.#preferences.get(normalized.id).layout;
    this.#definitions.set(normalized.id, normalized);
    this.#locations.set(normalized.id, normalized.initialLocation ?? "/");
    this.#layouts.set(
      normalized.id,
      preferredLayout && layout.supported.includes(preferredLayout)
        ? preferredLayout
        : layout.default,
    );
    if (normalized.lifecycle?.mount === "eager") {
      this.#mounted.add(normalized.id);
    }
    this.#publish();

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.#definitions.delete(normalized.id);
      this.#locations.delete(normalized.id);
      this.#layouts.delete(normalized.id);
      this.#mounted.delete(normalized.id);
      this.#agents.delete(normalized.id);
      if (this.#activeId === normalized.id) this.#activeId = null;
      this.#publish();
    };
  }

  registerAgent(
    surfaceId: string,
    registration: ReactSurfaceAgentRegistration,
  ): () => void {
    if (!this.#definitions.has(surfaceId)) {
      throw new RangeError(`Unknown React surface: ${surfaceId}`);
    }
    validateAgentRegistration(registration);
    const current = this.#agents.get(surfaceId);
    if (current === registration) return () => {};
    this.#agents.set(surfaceId, registration);
    this.#publish();

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (this.#agents.get(surfaceId) !== registration) return;
      this.#agents.delete(surfaceId);
      this.#publish();
    };
  }

  getAgentRegistration = (
    surfaceId: string,
  ): ReactSurfaceAgentRegistration | undefined => this.#agents.get(surfaceId);

  open(id: string, location?: string): void {
    if (!this.#definitions.has(id)) {
      throw new RangeError(`Unknown React surface: ${id}`);
    }
    if (location?.includes("\0")) {
      throw new TypeError("React surface location must not contain NUL");
    }

    const nextLocation = location ?? this.#locations.get(id) ?? "/";
    if (
      this.#activeId === id &&
      this.#locations.get(id) === nextLocation &&
      this.#mounted.has(id)
    ) {
      return;
    }
    this.#releaseHiddenSurface(this.#activeId);
    this.#activeId = id;
    this.#mounted.add(id);
    this.#locations.set(id, nextLocation);
    this.#publish();
  }

  close(): void {
    if (this.#activeId === null) return;
    const prior = this.#activeId;
    this.#activeId = null;
    this.#releaseHiddenSurface(prior);
    this.#publish();
  }

  navigate(location: string): void {
    if (this.#activeId === null) {
      throw new Error("Cannot navigate without an active React surface");
    }
    if (location.includes("\0")) {
      throw new TypeError("React surface location must not contain NUL");
    }
    if (this.#locations.get(this.#activeId) === location) return;
    this.#locations.set(this.#activeId, location);
    this.#publish();
  }

  setLayout(id: string, layout: ReactSurfaceLayout): void {
    const definition = this.#definitions.get(id);
    if (!definition) throw new RangeError(`Unknown React surface: ${id}`);
    const configuration = getReactSurfaceLayoutConfiguration(definition);
    if (!configuration.supported.includes(layout)) {
      throw new RangeError(
        `React surface ${id} does not support layout: ${layout}`,
      );
    }
    if (this.#layouts.get(id) === layout) return;
    this.#layouts.set(id, layout);
    if (configuration.persist) this.#preferences.setLayout(id, layout);
    this.#publish();
  }

  resetPreferences(id?: string): void {
    this.#preferences.reset(id);
    if (id !== undefined && !this.#definitions.has(id)) return;
    this.#syncPersistedLayouts(id);
  }

  inspect(): ReactSurfaceDiagnostics {
    return Object.freeze({
      runtime: this.#snapshot.runtime,
      activeId: this.#activeId,
      surfaces: Object.freeze(
        this.#snapshot.surfaces.map((surface) =>
          Object.freeze({
            id: surface.definition.id,
            layout: surface.layout,
            mounted: surface.mounted,
            registeredAgentTools:
              this.#agents.get(surface.definition.id)?.tools.length ?? 0,
          }),
        ),
      ),
    });
  }

  getSnapshot = (): ReactSurfaceSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  dispose(): void {
    this.#unsubscribePreferences();
  }

  /** Internal runtime seam used by the optional Agent bridge. */
  setAgentCapability(capability: ReactSurfaceAgentCapability): void {
    if (sameAgentCapability(this.#agentCapability, capability)) return;
    this.#agentCapability = Object.freeze({ ...capability });
    this.#publish();
  }

  /** Internal runtime seam used by the DSH host adapter. */
  setShellDiagnostics(diagnostics: ReactSurfaceShellDiagnostics): void {
    if (sameShellDiagnostics(this.#shellDiagnostics, diagnostics)) return;
    this.#shellDiagnostics = Object.freeze({ ...diagnostics });
    this.#publish();
  }

  get preferences(): ReactSurfacePreferenceStore {
    return this.#preferences;
  }

  #releaseHiddenSurface(id: string | null): void {
    if (!id) return;
    const definition = this.#definitions.get(id);
    if (definition?.lifecycle?.retention === "unmount-on-close") {
      this.#mounted.delete(id);
      this.#agents.delete(id);
    }
  }

  #syncPersistedLayouts(onlyId?: string): void {
    let changed = false;
    for (const [id, definition] of this.#definitions) {
      if (onlyId !== undefined && id !== onlyId) continue;
      const configuration = getReactSurfaceLayoutConfiguration(definition);
      const preferred = this.#preferences.get(id).layout;
      const next =
        preferred && configuration.supported.includes(preferred)
          ? preferred
          : configuration.default;
      if (this.#layouts.get(id) === next) continue;
      this.#layouts.set(id, next);
      changed = true;
    }
    if (changed) this.#publish();
  }

  #publish(): void {
    this.#snapshot = this.#createSnapshot();
    for (const listener of this.#listeners) listener();
  }

  #createSnapshot(): ReactSurfaceSnapshot {
    const surfaces: RegisteredReactSurface[] = Array.from(
      this.#definitions.values(),
      (definition) =>
        Object.freeze({
          definition,
          location: this.#locations.get(definition.id) ?? "/",
          layout:
            this.#layouts.get(definition.id) ??
            getReactSurfaceLayoutConfiguration(definition).default,
          mounted: this.#mounted.has(definition.id),
        }),
    ).sort(compareSurfaces);

    return Object.freeze({
      activeId: this.#activeId,
      surfaces: Object.freeze(surfaces),
      runtime: createRuntimeSnapshot(
        this.#agentCapability,
        this.#shellDiagnostics,
      ),
    });
  }
}

function createRuntimeSnapshot(
  agent: ReactSurfaceAgentCapability,
  shell: ReactSurfaceShellDiagnostics,
): ReactSurfaceRuntimeSnapshot {
  return Object.freeze({
    interfaceVersion: REACT_SURFACE_INTERFACE_VERSION,
    version: REACT_SURFACE_RUNTIME_VERSION,
    features: REACT_SURFACE_FEATURES,
    capabilities: Object.freeze({ agent }),
    shell,
  });
}

function validateAgentRegistration(
  registration: ReactSurfaceAgentRegistration,
): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(registration.scopeKey)) {
    throw new TypeError("React surface Agent scopeKey is invalid");
  }
  if (!registration.label.trim()) {
    throw new TypeError("React surface Agent label must not be empty");
  }
  if (!Array.isArray(registration.tools) || registration.tools.length > 32) {
    throw new TypeError(
      "React surface Agent tools must contain at most 32 items",
    );
  }
  const names = new Set<string>();
  for (const tool of registration.tools) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(tool.name)) {
      throw new TypeError(
        `Invalid React surface Agent tool name: ${tool.name}`,
      );
    }
    if (!tool.description.trim() || typeof tool.execute !== "function") {
      throw new TypeError(`Invalid React surface Agent tool: ${tool.name}`);
    }
    if (
      !tool.parameters ||
      typeof tool.parameters !== "object" ||
      Array.isArray(tool.parameters) ||
      tool.parameters.type !== "object"
    ) {
      throw new TypeError(
        `React surface Agent tool schema must be object-rooted: ${tool.name}`,
      );
    }
    if (names.has(tool.name)) {
      throw new TypeError(
        `Duplicate React surface Agent tool name: ${tool.name}`,
      );
    }
    names.add(tool.name);
  }
}

function compareSurfaces(
  left: RegisteredReactSurface,
  right: RegisteredReactSurface,
) {
  const order = (left.definition.order ?? 0) - (right.definition.order ?? 0);
  if (order !== 0) return order;
  return left.definition.title.localeCompare(right.definition.title);
}

function sameAgentCapability(
  left: ReactSurfaceAgentCapability,
  right: ReactSurfaceAgentCapability,
): boolean {
  return (
    left.available === right.available &&
    left.status === right.status &&
    left.reason === right.reason
  );
}

function sameShellDiagnostics(
  left: ReactSurfaceShellDiagnostics,
  right: ReactSurfaceShellDiagnostics,
): boolean {
  return (
    left.compatible === right.compatible &&
    left.requestedLayout === right.requestedLayout &&
    left.resolvedLayout === right.resolvedLayout &&
    left.reason === right.reason
  );
}
