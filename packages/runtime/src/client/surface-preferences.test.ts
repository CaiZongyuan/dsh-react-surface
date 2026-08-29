import { describe, expect, test } from "bun:test";

import { ReactSurfacePreferenceStore } from "./surface-preferences.ts";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("ReactSurfacePreferenceStore", () => {
  test("persists only layout UI state using a versioned key", () => {
    const storage = new MemoryStorage();
    const preferences = new ReactSurfacePreferenceStore(storage);

    preferences.setLayout("example.app", "workspace");
    preferences.setSize("example.app", "conversation", 417.4);

    expect(new ReactSurfacePreferenceStore(storage).get("example.app")).toEqual(
      {
        layout: "workspace",
        sizes: { conversation: 417 },
      },
    );
    expect([...storage.values.keys()]).toEqual([
      "dsh-react-surface:preferences:v1",
    ]);
  });

  test("sanitizes invalid stored state", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "dsh-react-surface:preferences:v1",
      JSON.stringify({
        version: 1,
        surfaces: {
          "example.valid": {
            layout: "right-panel",
            sizes: { rightPanel: 460, conversation: -1, unknown: 20 },
          },
          "invalid id": { layout: "workspace" },
        },
      }),
    );

    expect(
      new ReactSurfacePreferenceStore(storage).get("example.valid"),
    ).toEqual({
      layout: "right-panel",
      sizes: { rightPanel: 460 },
    });
    expect(new ReactSurfacePreferenceStore(storage).get("invalid id")).toEqual({
      sizes: {},
    });
  });

  test("keeps working when storage throws and supports reset", () => {
    const preferences = new ReactSurfacePreferenceStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("disabled");
      },
      removeItem: () => {
        throw new Error("disabled");
      },
    });

    preferences.setLayout("example.app", "center");
    expect(preferences.get("example.app").layout).toBe("center");
    preferences.reset("example.app");
    expect(preferences.get("example.app")).toEqual({ sizes: {} });
  });
});
