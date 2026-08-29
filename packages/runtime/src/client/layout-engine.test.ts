import { describe, expect, test } from "bun:test";

import type { ReactSurfaceLayoutConfiguration } from "./contracts.ts";
import { resolveReactSurfaceLayout } from "./layout-engine.ts";

const configuration: ReactSurfaceLayoutConfiguration = {
  default: "workspace",
  supported: [
    "full-frame",
    "center",
    "workspace",
    "right-panel",
    "bottom-panel",
  ],
  fallback: "full-frame",
  resizable: true,
};

const desktop = {
  width: 1440,
  height: 900,
  sidebarWidth: 280,
  detailsWidth: 0,
};

describe("resolveReactSurfaceLayout", () => {
  test("resolves every semantic desktop preset", () => {
    expect(
      resolveReactSurfaceLayout({
        requested: "full-frame",
        configuration,
        geometry: desktop,
      }).bounds,
    ).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(
      resolveReactSurfaceLayout({
        requested: "center",
        configuration,
        geometry: desktop,
      }).bounds.left,
    ).toBe(280);
    expect(
      resolveReactSurfaceLayout({
        requested: "workspace",
        configuration,
        geometry: desktop,
      }),
    ).toMatchObject({
      resolved: "workspace",
      bounds: { left: 280, right: 440 },
      nativePane: { width: 440, justifySelf: "end" },
      resize: { key: "conversation", edge: "right" },
    });
    expect(
      resolveReactSurfaceLayout({
        requested: "right-panel",
        configuration,
        geometry: desktop,
      }),
    ).toMatchObject({
      resolved: "right-panel",
      bounds: { left: 1020, right: 0 },
      nativePane: { width: 740, justifySelf: "start" },
      resize: { key: "rightPanel", value: 420 },
    });
    expect(
      resolveReactSurfaceLayout({
        requested: "bottom-panel",
        configuration,
        geometry: desktop,
      }),
    ).toMatchObject({
      resolved: "bottom-panel",
      bounds: { top: 580, left: 280 },
      nativePane: { height: 580, alignSelf: "start" },
      resize: { key: "bottomPanel", value: 320 },
    });
  });

  test("uses retained panel sizes within declared constraints", () => {
    expect(
      resolveReactSurfaceLayout({
        requested: "workspace",
        configuration,
        geometry: desktop,
        preferredSizes: { conversation: 375 },
      }),
    ).toMatchObject({
      bounds: { right: 375 },
      nativePane: { width: 375 },
      resize: { value: 375 },
    });
  });

  test("falls back without mutating native panes on narrow screens", () => {
    const result = resolveReactSurfaceLayout({
      requested: "workspace",
      configuration,
      geometry: { width: 900, height: 700, sidebarWidth: 280, detailsWidth: 0 },
    });

    expect(result.resolved).toBe("full-frame");
    expect(result.nativePane).toEqual({});
    expect(result.reason).toContain("minimum widths");
  });

  test("can degrade a split to center while retaining the sidebar", () => {
    const result = resolveReactSurfaceLayout({
      requested: "right-panel",
      configuration: { ...configuration, fallback: "center" },
      geometry: { width: 950, height: 700, sidebarWidth: 280, detailsWidth: 0 },
    });

    expect(result).toMatchObject({
      requested: "right-panel",
      resolved: "center",
      bounds: { left: 280 },
    });
    expect(result.reason).toContain("right panel");
  });
});
