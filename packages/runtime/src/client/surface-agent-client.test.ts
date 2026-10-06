import { expect, spyOn, test } from "bun:test";
import { SurfaceAgentClientBridge } from "./surface-agent-client.ts";
import { ReactSurfaceRegistryImpl } from "./registry.ts";

test("leases only the selected uiSession binding and releases on selection changes", async () => {
  const listeners = new Set<() => void>();
  let key: string | undefined;
  const binding = {
    adapter: {
      current: {
        getSnapshot: () => ({ key }),
        subscribe(listener: () => void) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
    },
  };
  const leases: string[] = [];
  let releases = 0;
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const path = String(input);
        if (path.endsWith("/capabilities"))
          return Response.json({
            data: {
              available: true,
              protocolVersion: 1,
              features: [
                "capability-token",
                "lease-ttl",
                "session-scoped-tools",
              ],
            },
          });
        if (path.endsWith("/lease")) {
          const request = JSON.parse(String(init?.body));
          leases.push(request.sessionId);
          return Response.json({
            data: { active: true, token: "test-token", ttlMs: 45000 },
          });
        }
        if (path.endsWith("/release")) {
          releases++;
          return Response.json({ data: { released: true } });
        }
        if (path.endsWith("/poll"))
          return new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          });
        throw new Error("Unexpected bridge route: " + path);
      },
      { preconnect: fetch.preconnect },
    ),
  );
  const registry = new ReactSurfaceRegistryImpl();
  registry.register({
    id: "example.test",
    title: "Test",
    component: () => null,
  });
  registry.registerAgent("example.test", {
    scopeKey: "test",
    label: "Test",
    tools: [
      {
        name: "test_context",
        description: "Read test context",
        parameters: { type: "object" },
        execute: () => "test",
      },
    ],
  });
  registry.open("example.test");
  const bridge = new SurfaceAgentClientBridge(binding, registry);
  async function settled(assertion: () => boolean) {
    for (let round = 0; round < 100 && !assertion(); round++)
      await Bun.sleep(2);
    expect(assertion()).toBe(true);
  }
  const select = (next: string | undefined) => {
    key = next;
    for (const listener of listeners) listener();
  };
  try {
    await settled(
      () => registry.getSnapshot().runtime.capabilities.agent.status === "idle",
    );
    expect(leases).toEqual([]);
    select("session-a");
    await settled(() => leases.length === 1);
    select("session-b");
    await settled(() => leases.length === 2);
    expect(leases).toEqual(["session-a", "session-b"]);
    select(undefined);
    await settled(() => releases === 2);
    expect(registry.getSnapshot().runtime.capabilities.agent.status).toBe(
      "idle",
    );
  } finally {
    bridge.dispose();
    registry.dispose();
    fetchMock.mockRestore();
  }
  expect(listeners.size).toBe(0);
});
