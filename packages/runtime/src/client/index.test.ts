import { expect, test } from "bun:test";
import { Context } from "@deepseek-ai/cordis";

import { apply, inject } from "./index.tsx";

test("keeps the Surface host available across Session Controller lifetimes", async () => {
  const ctx = new Context();
  const listeners = new Set<() => void>();
  const slots = new Set<string>();
  ctx.reflect.provide("slots", {
    inject(_name: string, register: () => () => void) {
      return register();
    },
    register({ id }: { id: string }) {
      slots.add(id);
      return () => slots.delete(id);
    },
  });
  const runtime = ctx.plugin({ apply, inject });
  try {
    await runtime.await();
    const registry = ctx.reactSurfaces;
    expect(registry).toBeDefined();
    expect(slots.size).toBe(2);
    registry.register({
      id: "example.test",
      title: "Test",
      component: () => null,
    });
    registry.open("example.test");

    const provideSessions = () =>
      ctx.plugin((provider) => {
        provider.reflect.provide("sessions", {
          list: {
            getSnapshot: () => ({ current: undefined }),
            subscribe(listener: () => void) {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          },
        });
      });
    const first = provideSessions();
    await first.await();
    await Bun.sleep(0);
    expect(listeners.size).toBe(1);
    await first.dispose();
    expect(listeners.size).toBe(0);
    expect(ctx.reactSurfaces).toBe(registry);
    expect(registry.getSnapshot().activeId).toBe("example.test");
    expect(slots.size).toBe(2);

    const second = provideSessions();
    await second.await();
    await Bun.sleep(0);
    expect(listeners.size).toBe(1);
    await runtime.dispose();
    expect(listeners.size).toBe(0);
    expect(slots.size).toBe(0);
    await second.dispose();
  } finally {
    await ctx.fiber.dispose();
  }
});
