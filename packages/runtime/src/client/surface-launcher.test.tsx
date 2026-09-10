import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { defineReactSurface } from "./contracts.ts";
import { ReactSurfaceRegistryImpl } from "./registry.ts";
import {
  openSoleInactiveSurface,
  SurfaceLauncher,
} from "./surface-launcher.tsx";

function TestSurface() {
  return null;
}

function registerDashboard(registry: ReactSurfaceRegistryImpl): void {
  registry.register(
    defineReactSurface({
      id: "acme.dashboard",
      title: "Acme Dashboard",
      branding: { identity: { name: "Acme Dashboard", mark: "AD" } },
      component: TestSurface,
    }),
  );
}

describe("SurfaceLauncher", () => {
  test("projects a sole application's identity and opens it directly", () => {
    const registry = new ReactSurfaceRegistryImpl();
    registerDashboard(registry);

    const inactive = renderToStaticMarkup(
      <SurfaceLauncher registry={registry} wide />,
    );
    expect(inactive).toContain('aria-label="Acme Dashboard"');
    expect(inactive).toContain(">AD<");
    expect(inactive).toContain(">Acme Dashboard<");
    expect(inactive).not.toContain("aria-haspopup");

    expect(openSoleInactiveSurface(registry)).toBe(true);
    expect(registry.getSnapshot().activeId).toBe("acme.dashboard");

    const active = renderToStaticMarkup(
      <SurfaceLauncher registry={registry} wide />,
    );
    expect(active).toContain('aria-current="page"');
    expect(active).toContain('aria-haspopup="menu"');
    expect(openSoleInactiveSurface(registry)).toBe(false);
  });

  test("keeps the sole application accessible in the rail", () => {
    const registry = new ReactSurfaceRegistryImpl();
    registerDashboard(registry);

    const rail = renderToStaticMarkup(
      <SurfaceLauncher registry={registry} wide={false} />,
    );
    expect(rail).toContain('aria-label="Acme Dashboard"');
    expect(rail).toContain('title="Acme Dashboard"');
    expect(rail).toContain(">AD<");
    expect(rail).not.toContain(">Acme Dashboard</span>");
  });

  test("retains the selection menu for multiple applications", () => {
    const registry = new ReactSurfaceRegistryImpl();
    registerDashboard(registry);
    registry.register(
      defineReactSurface({
        id: "example.second",
        title: "Second application",
        component: TestSurface,
      }),
    );

    const markup = renderToStaticMarkup(
      <SurfaceLauncher registry={registry} wide />,
    );
    expect(markup).toContain('aria-label="React applications"');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(openSoleInactiveSurface(registry)).toBe(false);
    expect(registry.getSnapshot().activeId).toBeNull();
  });
});
