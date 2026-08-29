import { describe, expect, test } from "bun:test";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";

import { SURFACE_AGENT_PATH } from "./agent-protocol.ts";
import { SurfaceAgentHost } from "./agent-host.ts";

interface RouteRegistration {
  handler(request: IncomingMessage, response: ServerResponse): Promise<void>;
}

class FakeResponse {
  headersSent = false;
  writableEnded = false;
  status = 0;
  body = "";
  readonly headers = new Map<string, string | number>();

  setHeader(name: string, value: string | number) {
    this.headers.set(name, value);
  }

  writeHead(status: number, headers: Record<string, string | number>) {
    this.status = status;
    this.headersSent = true;
    for (const [name, value] of Object.entries(headers)) {
      this.headers.set(name, value);
    }
  }

  end(body = "") {
    this.body = body;
    this.writableEnded = true;
  }

  once() {}
  off() {}
  destroy() {
    this.writableEnded = true;
  }
}

function createHost() {
  let route: RouteRegistration | undefined;
  let invokeTool:
    | ((
        call: { callId: string; name: string; arguments: unknown },
        signal: AbortSignal,
      ) => Promise<string>)
    | undefined;
  const cleanups: Array<() => void> = [];
  const ctx = {
    webServer: {
      register(registration: RouteRegistration) {
        route = registration;
        return () => {};
      },
    },
    agents: { get: () => ({}) },
    logger: { warn: () => {} },
    effect(factory: () => (() => void) | void) {
      const cleanup = factory();
      if (cleanup) cleanups.push(cleanup);
    },
    get: () => undefined,
  };
  const broker = {
    bind(
      _agent: unknown,
      _owner: string,
      _tools: unknown,
      transport: {
        invoke(
          call: { callId: string; name: string; arguments: unknown },
          signal: AbortSignal,
        ): Promise<string>;
      },
    ) {
      invokeTool = transport.invoke;
      return { dispose: () => {} };
    },
  };
  new SurfaceAgentHost(ctx as unknown as Context, broker as never);
  return {
    async post(path: string, body: object, trusted = true) {
      const request = Readable.from([JSON.stringify(body)]) as IncomingMessage;
      Object.assign(request, {
        method: "POST",
        url: path,
        headers: {
          "content-type": "application/json",
          host: "127.0.0.1:14567",
          origin: "http://127.0.0.1:14567",
          "sec-fetch-site": trusted ? "same-origin" : "cross-site",
        },
      });
      Object.defineProperty(request, "socket", {
        value: { remoteAddress: "127.0.0.1" },
      });
      const response = new FakeResponse();
      await route?.handler(request, response as unknown as ServerResponse);
      return {
        status: response.status,
        value: JSON.parse(response.body) as Record<string, unknown>,
      };
    },
    dispose() {
      for (const cleanup of cleanups.reverse()) cleanup();
    },
    invoke(
      call: { callId: string; name: string; arguments: unknown },
      signal = new AbortController().signal,
    ) {
      if (!invokeTool) throw new Error("Browser Tool broker is not bound");
      return invokeTool(call, signal);
    },
  };
}

function leaseRequest(clientId: string) {
  return {
    clientId,
    revision: 1,
    sessionId: "session-1",
    surfaceId: "example.surface",
    scopeKey: "document:1",
    label: "Example document",
    tools: [
      {
        name: "read_document",
        description: "Read the active document",
        parameters: { type: "object", properties: {} },
      },
    ],
  };
}

describe("SurfaceAgentHost", () => {
  test("reports optional dsh-ag-ui capabilities to trusted clients", async () => {
    const host = createHost();
    const result = await host.post(`${SURFACE_AGENT_PATH}/capabilities`, {});

    expect(result.status).toBe(200);
    expect(result.value).toMatchObject({
      data: {
        available: true,
        protocolVersion: 1,
        features: ["capability-token", "lease-ttl", "session-scoped-tools"],
      },
    });
    host.dispose();
  });

  test("rejects cross-site requests before parsing a lease", async () => {
    const host = createHost();
    const result = await host.post(
      `${SURFACE_AGENT_PATH}/lease`,
      leaseRequest("client-1"),
      false,
    );

    expect(result).toMatchObject({
      status: 403,
      value: { error: { code: "REQUEST_NOT_TRUSTED" } },
    });
    host.dispose();
  });

  test("protects one Session lease with contention and a capability token", async () => {
    const host = createHost();
    const first = await host.post(
      `${SURFACE_AGENT_PATH}/lease`,
      leaseRequest("client-1"),
    );
    const token = (first.value.data as { token: string }).token;

    expect(token.length).toBeGreaterThan(32);
    expect(
      await host.post(`${SURFACE_AGENT_PATH}/lease`, leaseRequest("client-2")),
    ).toMatchObject({
      status: 409,
      value: { error: { code: "LEASE_CONTENDED" } },
    });
    expect(
      await host.post(`${SURFACE_AGENT_PATH}/release`, {
        clientId: "client-1",
        revision: 1,
        token: "invalid-token-invalid-token-invalid-token",
      }),
    ).toMatchObject({
      status: 409,
      value: { error: { code: "LEASE_NOT_ACTIVE" } },
    });
    expect(
      await host.post(`${SURFACE_AGENT_PATH}/release`, {
        clientId: "client-1",
        revision: 1,
        token,
      }),
    ).toMatchObject({ status: 200, value: { data: { released: true } } });
    host.dispose();
  });

  test("round-trips a dsh-ag-ui browser Tool invocation", async () => {
    const host = createHost();
    const lease = await host.post(
      `${SURFACE_AGENT_PATH}/lease`,
      leaseRequest("client-1"),
    );
    const token = (lease.value.data as { token: string }).token;
    const resultPromise = host.invoke({
      callId: "call-1",
      name: "read_document",
      arguments: {},
    });

    expect(
      await host.post(`${SURFACE_AGENT_PATH}/poll`, {
        clientId: "client-1",
        revision: 1,
        token,
      }),
    ).toMatchObject({
      status: 200,
      value: {
        data: {
          invocation: { callId: "call-1", name: "read_document" },
        },
      },
    });
    await host.post(`${SURFACE_AGENT_PATH}/result`, {
      clientId: "client-1",
      revision: 1,
      token,
      callId: "call-1",
      ok: true,
      value: '{"document":"ready"}',
    });
    expect(await resultPromise).toBe('{"document":"ready"}');
    host.dispose();
  });
});
