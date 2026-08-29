import { describe, expect, test } from "bun:test";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";

import type { ReactSurfaceProps } from "./contracts.ts";
import { activateSurfaceBrandSlots } from "./brand-slots.tsx";
import { ReactSurfaceRegistryImpl } from "./registry.ts";

function TestSurface(_props: ReactSurfaceProps) {
  return null;
}

describe("activateSurfaceBrandSlots", () => {
  test("occupies official brand slots only while a branded Surface is active", () => {
    const registered: string[] = [];
    const disposed: string[] = [];
    const ctx = {
      slots: {
        inject(_name: string, register: () => () => void) {
          return register();
        },
        register(options: { name: string }) {
          registered.push(options.name);
          return () => disposed.push(options.name);
        },
      },
    };
    const registry = new ReactSurfaceRegistryImpl();
    registry.register({
      id: "example.brand",
      title: "Example",
      component: TestSurface,
      branding: {
        shell: "surface",
        identity: { name: "Example Product", mark: "EP" },
      },
    });
    const dispose = activateSurfaceBrandSlots(
      ctx as unknown as ClientContext,
      registry,
    );

    expect(registered).toEqual([]);
    registry.open("example.brand");
    expect(registered).toEqual(["sidebar.brand.mark", "sidebar.brand.name"]);
    registry.close();
    expect(disposed).toEqual(["sidebar.brand.name", "sidebar.brand.mark"]);

    dispose();
  });
});
