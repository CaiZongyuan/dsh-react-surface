import { describe, expect, test } from "bun:test";

import { resolveWorkspaceLayout } from "./workspace-layout.ts";

describe("resolveWorkspaceLayout", () => {
  test("allocates the center surface and a bounded right conversation", () => {
    expect(
      resolveWorkspaceLayout({ frameWidth: 1440, sidebarWidth: 280 }),
    ).toEqual({ conversationWidth: 440, surfaceWidth: 720 });
    expect(
      resolveWorkspaceLayout({ frameWidth: 1262, sidebarWidth: 280 }),
    ).toEqual({ conversationWidth: 391, surfaceWidth: 591 });
  });

  test("falls back when the business surface would become unusable", () => {
    expect(
      resolveWorkspaceLayout({ frameWidth: 1024, sidebarWidth: 280 }),
    ).toBeNull();
    expect(
      resolveWorkspaceLayout({ frameWidth: 844, sidebarWidth: 56 }),
    ).toBeNull();
  });
});
