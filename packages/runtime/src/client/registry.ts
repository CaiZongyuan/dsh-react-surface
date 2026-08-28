import type {
  ReactSurfaceDefinition,
  ReactSurfaceAgentRegistration,
  ReactSurfaceRegistry,
  ReactSurfaceSnapshot,
  RegisteredReactSurface,
} from "./contracts.ts";
import { defineReactSurface } from "./contracts.ts";

const EMPTY_SNAPSHOT: ReactSurfaceSnapshot = Object.freeze({
  activeId: null,
  surfaces: Object.freeze([]),
});

export class ReactSurfaceRegistryImpl implements ReactSurfaceRegistry {
  readonly #definitions = new Map<string, Readonly<ReactSurfaceDefinition>>();
  readonly #locations = new Map<string, string>();
  readonly #agents = new Map<string, ReactSurfaceAgentRegistration>();
  readonly #listeners = new Set<() => void>();
  #activeId: string | null = null;
  #snapshot: ReactSurfaceSnapshot = EMPTY_SNAPSHOT;

  register(definition: ReactSurfaceDefinition): () => void {
    const normalized = defineReactSurface(definition);
    if (this.#definitions.has(normalized.id)) {
      throw new Error(`React surface is already registered: ${normalized.id}`);
    }

    this.#definitions.set(normalized.id, normalized);
    this.#locations.set(normalized.id, normalized.initialLocation ?? "/");
    this.#publish();

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.#definitions.delete(normalized.id);
      this.#locations.delete(normalized.id);
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
    if (this.#activeId === id && this.#locations.get(id) === nextLocation)
      return;
    this.#activeId = id;
    this.#locations.set(id, nextLocation);
    this.#publish();
  }

  close(): void {
    if (this.#activeId === null) return;
    this.#activeId = null;
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

  getSnapshot = (): ReactSurfaceSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #publish(): void {
    const surfaces: RegisteredReactSurface[] = Array.from(
      this.#definitions.values(),
      (definition) =>
        Object.freeze({
          definition,
          location: this.#locations.get(definition.id) ?? "/",
        }),
    ).sort(compareSurfaces);

    this.#snapshot = Object.freeze({
      activeId: this.#activeId,
      surfaces: Object.freeze(surfaces),
    });
    for (const listener of this.#listeners) listener();
  }
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
