import type { ReactSurfaceLayout } from "./contracts.ts";

export type ReactSurfacePanelSize =
  "bottomPanel" | "conversation" | "rightPanel";

export interface ReactSurfacePreferenceSnapshot {
  readonly layout?: ReactSurfaceLayout;
  readonly sizes: Readonly<Partial<Record<ReactSurfacePanelSize, number>>>;
}

interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredPreferencesV1 {
  version: 1;
  surfaces: Record<
    string,
    {
      layout?: ReactSurfaceLayout;
      sizes?: Partial<Record<ReactSurfacePanelSize, number>>;
    }
  >;
}

const STORAGE_KEY = "dsh-react-surface:preferences:v1";
const EMPTY_PREFERENCES: ReactSurfacePreferenceSnapshot = Object.freeze({
  sizes: Object.freeze({}),
});
const VALID_LAYOUTS = new Set<ReactSurfaceLayout>([
  "full-frame",
  "center",
  "workspace",
  "right-panel",
  "bottom-panel",
]);
const VALID_SIZE_KEYS: readonly ReactSurfacePanelSize[] = [
  "bottomPanel",
  "conversation",
  "rightPanel",
];

/** Versioned, UI-only preferences shared by the registry and shell host. */
export class ReactSurfacePreferenceStore {
  readonly #listeners = new Set<() => void>();
  #state: StoredPreferencesV1;

  constructor(private readonly storage?: StoragePort) {
    this.#state = readPreferences(storage);
  }

  get(surfaceId: string): ReactSurfacePreferenceSnapshot {
    const value = this.#state.surfaces[surfaceId];
    if (!value) return EMPTY_PREFERENCES;
    return Object.freeze({
      ...(value.layout === undefined ? {} : { layout: value.layout }),
      sizes: Object.freeze({ ...(value.sizes ?? {}) }),
    });
  }

  setLayout(surfaceId: string, layout: ReactSurfaceLayout): void {
    const current = this.#state.surfaces[surfaceId];
    if (current?.layout === layout) return;
    this.#state.surfaces[surfaceId] = { ...current, layout };
    this.#commit();
  }

  setSize(surfaceId: string, key: ReactSurfacePanelSize, value: number): void {
    if (!Number.isFinite(value) || value <= 0) return;
    const rounded = Math.round(value);
    const current = this.#state.surfaces[surfaceId];
    if (current?.sizes?.[key] === rounded) return;
    this.#state.surfaces[surfaceId] = {
      ...current,
      sizes: { ...current?.sizes, [key]: rounded },
    };
    this.#commit();
  }

  reset(surfaceId?: string): void {
    if (surfaceId === undefined) {
      if (Object.keys(this.#state.surfaces).length === 0) return;
      this.#state = { version: 1, surfaces: {} };
    } else {
      if (!(surfaceId in this.#state.surfaces)) return;
      delete this.#state.surfaces[surfaceId];
    }
    this.#commit();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #commit(): void {
    try {
      if (Object.keys(this.#state.surfaces).length === 0) {
        this.storage?.removeItem(STORAGE_KEY);
      } else {
        this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.#state));
      }
    } catch {
      // Browser storage may be disabled or full; preferences remain in memory.
    }
    for (const listener of this.#listeners) listener();
  }
}

export function createBrowserSurfacePreferences(): ReactSurfacePreferenceStore {
  let storage: StoragePort | undefined;
  try {
    storage = typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    storage = undefined;
  }
  return new ReactSurfacePreferenceStore(storage);
}

function readPreferences(
  storage: StoragePort | undefined,
): StoredPreferencesV1 {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, surfaces: {} };
    const value = JSON.parse(raw) as unknown;
    return sanitizePreferences(value);
  } catch {
    return { version: 1, surfaces: {} };
  }
}

function sanitizePreferences(value: unknown): StoredPreferencesV1 {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.surfaces)) {
    return { version: 1, surfaces: {} };
  }
  const surfaces: StoredPreferencesV1["surfaces"] = {};
  for (const [surfaceId, candidate] of Object.entries(value.surfaces)) {
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(surfaceId)) continue;
    if (!isRecord(candidate)) continue;
    const layout =
      typeof candidate.layout === "string" &&
      VALID_LAYOUTS.has(candidate.layout as ReactSurfaceLayout)
        ? (candidate.layout as ReactSurfaceLayout)
        : undefined;
    const candidateSizes = isRecord(candidate.sizes) ? candidate.sizes : {};
    const sizes = isRecord(candidate.sizes)
      ? Object.fromEntries(
          VALID_SIZE_KEYS.flatMap((key) => {
            const size = candidateSizes[key];
            return typeof size === "number" &&
              Number.isFinite(size) &&
              size > 0 &&
              size <= 10_000
              ? [[key, Math.round(size)]]
              : [];
          }),
        )
      : {};
    if (layout !== undefined || Object.keys(sizes).length > 0) {
      surfaces[surfaceId] = {
        ...(layout === undefined ? {} : { layout }),
        ...(Object.keys(sizes).length === 0 ? {} : { sizes }),
      };
    }
  }
  return { version: 1, surfaces };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
