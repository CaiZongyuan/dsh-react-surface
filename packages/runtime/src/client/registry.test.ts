import { describe, expect, test } from "bun:test";

import type { ReactSurfaceProps } from "./contracts.ts";
import { defineReactSurface } from "./contracts.ts";
import { ReactSurfaceRegistryImpl } from "./registry.ts";
import { ReactSurfacePreferenceStore } from "./surface-preferences.ts";

function TestSurface(_props: ReactSurfaceProps) {
  return null;
}

function surface(id: string, title = id, order?: number) {
  return defineReactSurface({
    id,
    title,
    component: TestSurface,
    ...(order === undefined ? {} : { order }),
  });
}

describe("ReactSurfaceRegistryImpl", () => {
  test("registers surfaces in stable display order", () => {
    const registry = new ReactSurfaceRegistryImpl();
    registry.register(surface("zeta", "Zeta", 20));
    registry.register(surface("alpha", "Alpha", 10));
    registry.register(surface("beta", "Beta", 10));

    expect(
      registry.getSnapshot().surfaces.map((entry) => entry.definition.id),
    ).toEqual(["alpha", "beta", "zeta"]);
  });

  test("retains each surface location while switching and closing", () => {
    const registry = new ReactSurfaceRegistryImpl();
    registry.register(surface("first"));
    registry.register(surface("second"));

    registry.open("first", "/patients/P001");
    registry.open("second", "/queue");
    registry.close();
    registry.open("first");

    const snapshot = registry.getSnapshot();
    expect(snapshot.activeId).toBe("first");
    expect(
      snapshot.surfaces.find((entry) => entry.definition.id === "first")
        ?.location,
    ).toBe("/patients/P001");
  });

  test("unregisters idempotently and closes the active surface", () => {
    const registry = new ReactSurfaceRegistryImpl();
    const dispose = registry.register(surface("first"));
    registry.open("first");

    dispose();
    dispose();

    expect(registry.getSnapshot()).toMatchObject({
      activeId: null,
      surfaces: [],
    });
  });

  test("rejects duplicate and unknown surfaces", () => {
    const registry = new ReactSurfaceRegistryImpl();
    registry.register(surface("first"));

    expect(() => registry.register(surface("first"))).toThrow(
      "React surface is already registered",
    );
    expect(() => registry.open("missing")).toThrow("Unknown React surface");
  });

  test("notifies only when observable state changes", () => {
    const registry = new ReactSurfaceRegistryImpl();
    let notifications = 0;
    registry.subscribe(() => notifications++);
    registry.register(surface("first"));
    registry.open("first");
    registry.open("first");
    registry.navigate("/");
    registry.navigate("/next");
    registry.close();
    registry.close();

    expect(notifications).toBe(4);
  });

  test("publishes a replaceable Agent capability lease per surface", () => {
    const registry = new ReactSurfaceRegistryImpl();
    const disposeSurface = registry.register(surface("first"));
    const first = {
      scopeKey: "document:first",
      label: "First document",
      tools: [
        {
          name: "surface_context",
          description: "Read the current context.",
          parameters: { type: "object", properties: {} },
          execute: () => "first",
        },
      ],
    };
    const second = { ...first, scopeKey: "document:second" };

    const disposeFirst = registry.registerAgent("first", first);
    expect(registry.getAgentRegistration("first")).toBe(first);
    const disposeSecond = registry.registerAgent("first", second);
    disposeFirst();
    expect(registry.getAgentRegistration("first")).toBe(second);

    disposeSecond();
    expect(registry.getAgentRegistration("first")).toBeUndefined();
    registry.registerAgent("first", first);
    disposeSurface();
    expect(registry.getAgentRegistration("first")).toBeUndefined();
  });

  test("rejects invalid Agent capability declarations", () => {
    const registry = new ReactSurfaceRegistryImpl();
    registry.register(surface("first"));
    expect(() =>
      registry.registerAgent("first", {
        scopeKey: "invalid scope",
        label: "Invalid",
        tools: [],
      }),
    ).toThrow("scopeKey");
    expect(() =>
      registry.registerAgent("first", {
        scopeKey: "valid",
        label: "Valid",
        tools: [
          {
            name: "bad.name",
            description: "Invalid",
            parameters: { type: "object" },
            execute: () => "",
          },
        ],
      }),
    ).toThrow("tool name");
  });
});

describe("defineReactSurface", () => {
  test("returns a frozen validated definition", () => {
    const definition = defineReactSurface({
      id: "example.surface",
      title: "Example",
      component: TestSurface,
      layout: "workspace",
    });

    expect(Object.isFrozen(definition)).toBe(true);
    expect(definition.layout).toBe("workspace");
  });

  test("rejects invalid identifiers, titles, and layouts", () => {
    expect(() => surface("Invalid ID")).toThrow("React surface id");
    expect(() => surface("valid", "   ")).toThrow("title must not be empty");
    expect(() =>
      defineReactSurface({
        id: "valid",
        title: "Valid",
        component: TestSurface,
        layout: "unknown" as never,
      }),
    ).toThrow("Unknown React surface layout");
  });

  test("supports flexible layout declarations and validates their constraints", () => {
    const definition = defineReactSurface({
      id: "flexible",
      title: "Flexible",
      component: TestSurface,
      layout: {
        default: "workspace",
        supported: ["workspace", "right-panel", "full-frame"],
        conversation: { min: 320, initial: 400, max: 520 },
      },
    });

    expect(definition.layout).toMatchObject({ default: "workspace" });
    expect(() =>
      defineReactSurface({
        id: "invalid",
        title: "Invalid",
        component: TestSurface,
        layout: {
          default: "workspace",
          supported: ["full-frame"],
        },
      }),
    ).toThrow("must include default");
  });

  test("validates optional shell brand identity", () => {
    expect(
      defineReactSurface({
        id: "branded",
        title: "Branded",
        component: TestSurface,
        branding: {
          shell: "surface",
          identity: { name: "Acme", mark: "AC" },
        },
      }).branding?.identity,
    ).toEqual({ name: "Acme", mark: "AC" });
    expect(() =>
      defineReactSurface({
        id: "invalid-brand",
        title: "Invalid",
        component: TestSurface,
        branding: { identity: { name: "Acme", mark: "TOO-LONG" } },
      }),
    ).toThrow("identity mark");
  });
});

describe("Surface lifecycle and preferences", () => {
  test("mounts lazily and retains state by default", () => {
    const registry = new ReactSurfaceRegistryImpl();
    registry.register(surface("first"));

    expect(registry.getSnapshot().surfaces[0]?.mounted).toBe(false);
    registry.open("first");
    expect(registry.getSnapshot().surfaces[0]?.mounted).toBe(true);
    registry.close();
    expect(registry.getSnapshot().surfaces[0]?.mounted).toBe(true);
  });

  test("supports eager and unmount-on-close policies", () => {
    const registry = new ReactSurfaceRegistryImpl();
    registry.register({
      ...surface("first"),
      lifecycle: { mount: "eager", retention: "unmount-on-close" },
    });

    expect(registry.getSnapshot().surfaces[0]?.mounted).toBe(true);
    registry.open("first");
    registry.close();
    expect(registry.getSnapshot().surfaces[0]?.mounted).toBe(false);
  });

  test("retains an allowed user layout and resets it safely", () => {
    const preferences = new ReactSurfacePreferenceStore();
    const registry = new ReactSurfaceRegistryImpl(preferences);
    registry.register({
      ...surface("first"),
      layout: {
        default: "workspace",
        supported: ["workspace", "right-panel"],
      },
    });

    registry.setLayout("first", "right-panel");
    expect(registry.getSnapshot().surfaces[0]?.layout).toBe("right-panel");
    expect(preferences.get("first").layout).toBe("right-panel");
    expect(() => registry.setLayout("first", "bottom-panel")).toThrow(
      "does not support",
    );

    registry.resetPreferences("first");
    expect(registry.getSnapshot().surfaces[0]?.layout).toBe("workspace");
  });

  test("diagnostics omit locations and Tool payloads", () => {
    const registry = new ReactSurfaceRegistryImpl();
    registry.register(surface("first"));
    registry.open("first", "/private/document/123");
    registry.registerAgent("first", {
      scopeKey: "private:123",
      label: "Private document",
      tools: [
        {
          name: "read_document",
          description: "Read the document",
          parameters: { type: "object" },
          execute: () => "secret",
        },
      ],
    });

    const report = JSON.stringify(registry.inspect());
    expect(report).not.toContain("private/document");
    expect(report).not.toContain("private:123");
    expect(report).not.toContain("secret");
    expect(registry.inspect().surfaces[0]?.registeredAgentTools).toBe(1);
  });
});
