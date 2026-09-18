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
  test("collapses the conversation and its details without covering navigation or losing split width", () => {
    const input = {
      requested: "workspace" as const,
      configuration: { ...configuration, fallback: "shrink" as const },
      geometry: { ...desktop, detailsWidth: 300 },
      preferredSizes: { conversation: 375 },
    };
    const expanded = resolveReactSurfaceLayout(input);
    const collapsed = resolveReactSurfaceLayout({
      ...input,
      conversationCollapsed: true,
    });
    expect(collapsed.resolved).toBe("workspace");
    expect(collapsed.bounds).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 280,
    });
    expect(collapsed.nativePane).toEqual({
      ...expanded.nativePane,
      hidden: true,
    });
    expect(collapsed.resize).toBeUndefined();
    expect(resolveReactSurfaceLayout(input)).toEqual(expanded);
    expect(
      resolveReactSurfaceLayout({
        ...input,
        conversationCollapsed: true,
        geometry: { ...desktop, width: 360 },
      }).bounds.left,
    ).toBe(280);
  });

  test("keeps an opted-in workspace beside its conversation when panels cannot fit", () => {
    for (const width of [360, 768, 1280, 2048]) {
      const geometry = {
        width,
        height: 700,
        sidebarWidth: 56,
        detailsWidth: width * 0.3,
      };
      const result = resolveReactSurfaceLayout({
        requested: "workspace",
        configuration: {
          ...configuration,
          fallback: "shrink",
          minSurfaceWidth: 360,
        },
        geometry,
        preferredSizes: { conversation: 400 },
      });
      expect(result.resolved).toBe("workspace");
      expect(result.bounds.left).toBe(56);
      expect(result.bounds.top).toBe(0);
      expect(result.bounds.bottom).toBe(0);
      expect(result.nativePane.width).toBeGreaterThan(0);
      expect(width - result.bounds.left - result.bounds.right).toBeGreaterThan(
        0,
      );
      expect(result.bounds.right).toBe(
        geometry.detailsWidth + result.nativePane.width!,
      );
    }
  });

  test("restores the preferred horizontal split after a narrow interval or manual full frame", () => {
    const input = {
      configuration: {
        ...configuration,
        fallback: "shrink" as const,
        minSurfaceWidth: 360,
      },
      preferredSizes: { conversation: 375 },
    };
    resolveReactSurfaceLayout({
      ...input,
      requested: "workspace",
      geometry: { ...desktop, width: 700 },
    });
    expect(
      resolveReactSurfaceLayout({
        ...input,
        requested: "full-frame",
        geometry: desktop,
      }).resolved,
    ).toBe("full-frame");
    expect(
      resolveReactSurfaceLayout({
        ...input,
        requested: "workspace",
        geometry: desktop,
      }),
    ).toMatchObject({
      resolved: "workspace",
      nativePane: { width: 375 },
      bounds: { left: 280, right: 375 },
    });
  });

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

  test("keeps the native details column beside a full-frame surface when opted in", () => {
    const geometry = { ...desktop, detailsWidth: 300 };
    const optedIn = resolveReactSurfaceLayout({
      requested: "full-frame",
      configuration: { ...configuration, fullFrameKeepDetails: true },
      geometry,
    });
    expect(optedIn.resolved).toBe("full-frame");
    expect(optedIn.keepDetails).toBe(true);
    expect(optedIn.bounds).toEqual({
      top: 0,
      right: 300,
      bottom: 0,
      left: 0,
    });
    // 右栏不存在(detailsWidth 为 0)时仍是纯全屏
    expect(
      resolveReactSurfaceLayout({
        requested: "full-frame",
        configuration: { ...configuration, fullFrameKeepDetails: true },
        geometry: desktop,
      }),
    ).toMatchObject({ resolved: "full-frame", bounds: { right: 0 } });
    // 未声明配置时不让位、不带标记
    const optedOut = resolveReactSurfaceLayout({
      requested: "full-frame",
      configuration,
      geometry,
    });
    expect(optedOut.keepDetails).toBeUndefined();
    expect(optedOut.bounds.right).toBe(0);
  });

  test("degrades full-frame keep-details back to a full overlay below the minimum surface width", () => {
    const result = resolveReactSurfaceLayout({
      requested: "full-frame",
      configuration: {
        ...configuration,
        fullFrameKeepDetails: true,
        minSurfaceWidth: 360,
      },
      geometry: { width: 600, height: 700, sidebarWidth: 0, detailsWidth: 300 },
    });
    expect(result.resolved).toBe("full-frame");
    expect(result.keepDetails).toBeUndefined();
    expect(result.bounds.right).toBe(0);
  });
});
