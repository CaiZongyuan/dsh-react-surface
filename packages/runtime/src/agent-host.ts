import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { SessionId } from "@deepseek-ai/dsh-session";
import type { ObjectJsonSchema } from "@deepseek-ai/dsh-tools";
import type {} from "@deepseek-ai/dsh-host-webserver";

import {
  SURFACE_AGENT_MAX_BODY_BYTES,
  SURFACE_AGENT_LEASE_TTL_MS,
  SURFACE_AGENT_PATH,
  type SurfaceAgentCapabilities,
  type SurfaceAgentEnvelope,
  type SurfaceAgentErrorEnvelope,
  type SurfaceAgentInvocation,
  type SurfaceAgentLeaseRequest,
  type SurfaceAgentLeaseResponse,
  type SurfaceAgentPollRequest,
  type SurfaceAgentReleaseRequest,
  type SurfaceAgentResultRequest,
} from "./agent-protocol.ts";
import { isSurfaceHostRequestAllowed } from "./trust-fence.ts";

const SURFACE_AGENT_CAPABILITIES: SurfaceAgentCapabilities = Object.freeze({
  available: true,
  protocolVersion: 1,
  features: Object.freeze([
    "capability-token",
    "lease-ttl",
    "session-scoped-tools",
  ] as const),
});

interface BrowserToolLeasePort {
  dispose(): void;
}

interface BrowserToolDescriptorPort {
  readonly name: string;
  readonly description: string;
  readonly parameters: ObjectJsonSchema & Record<string, unknown>;
}

interface BrowserToolBrokerPort {
  bind(
    agent: Agent,
    owner: string,
    tools: readonly BrowserToolDescriptorPort[],
    transport: {
      invoke(
        call: SurfaceAgentInvocation,
        signal: AbortSignal,
      ): Promise<string>;
    },
  ): BrowserToolLeasePort;
}

interface PendingInvocation {
  readonly call: SurfaceAgentInvocation;
  readonly onAbort: () => void;
  resolve(value: string): void;
  reject(error: Error): void;
}

class SurfaceAgentHttpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Host-side activation leases for native DSH Sessions. */
export class SurfaceAgentHost {
  readonly #leases = new Map<string, SurfaceAgentHostLease>();
  readonly #bySession = new Map<string, SurfaceAgentHostLease>();

  constructor(
    private readonly ctx: Context,
    private readonly broker: BrowserToolBrokerPort,
  ) {
    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: "prefix",
          path: SURFACE_AGENT_PATH,
          handler: (request, response) => this.#handle(request, response),
        }),
      "dsh-react-surface: native Session Agent bridge",
    );
    ctx.effect(
      () => () => {
        for (const lease of [...this.#leases.values()]) lease.dispose();
      },
      "dsh-react-surface: release native Session leases",
    );
  }

  async #handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      if (!isSurfaceHostRequestAllowed(this.ctx, request)) {
        throw new SurfaceAgentHttpError(
          "REQUEST_NOT_TRUSTED",
          "Surface Agent bridge accepts only loopback or live paired requests",
          403,
        );
      }
      if (request.method !== "POST") {
        response.setHeader("allow", "POST");
        throw new SurfaceAgentHttpError(
          "METHOD_NOT_ALLOWED",
          "Surface Agent bridge accepts POST requests only",
          405,
        );
      }
      const pathname = new URL(
        request.url ?? SURFACE_AGENT_PATH,
        "http://dsh.local",
      ).pathname;
      switch (pathname) {
        case `${SURFACE_AGENT_PATH}/capabilities`:
          sendJson(response, 200, { data: SURFACE_AGENT_CAPABILITIES });
          return;
        case `${SURFACE_AGENT_PATH}/lease`:
          sendJson(response, 200, {
            data: await this.#lease(parseLease(await readJson(request))),
          });
          return;
        case `${SURFACE_AGENT_PATH}/poll`: {
          const input = parsePoll(await readJson(request));
          const lease = this.#requireLease(input);
          const controller = new AbortController();
          const onClose = () => {
            if (!response.writableEnded) controller.abort();
          };
          response.once("close", onClose);
          const invocation = await lease.poll(controller.signal);
          response.off("close", onClose);
          sendJson(response, 200, { data: { invocation } });
          return;
        }
        case `${SURFACE_AGENT_PATH}/result`: {
          const input = parseResult(await readJson(request));
          this.#requireLease(input).settle(input);
          sendJson(response, 200, { data: { accepted: true } });
          return;
        }
        case `${SURFACE_AGENT_PATH}/release`: {
          const input = parseRelease(await readJson(request));
          const lease = this.#requireLease(input);
          lease.dispose();
          sendJson(response, 200, { data: { released: true } });
          return;
        }
        default:
          throw new SurfaceAgentHttpError(
            "NOT_FOUND",
            "Unknown Surface Agent bridge route",
            404,
          );
      }
    } catch (error) {
      const failure =
        error instanceof SurfaceAgentHttpError
          ? error
          : new SurfaceAgentHttpError(
              "SURFACE_AGENT_ERROR",
              "Surface Agent bridge request failed",
              500,
            );
      if (failure.status >= 500 && !(error instanceof SurfaceAgentHttpError)) {
        this.ctx.logger.warn(error);
      }
      if (!response.headersSent) {
        sendJson(response, failure.status, {
          error: { code: failure.code, message: failure.message },
        });
      } else if (!response.writableEnded) {
        response.destroy();
      }
    }
  }

  async #lease(
    input: SurfaceAgentLeaseRequest,
  ): Promise<SurfaceAgentLeaseResponse> {
    const agent = this.ctx.agents.get(SessionId(input.sessionId));
    if (!agent) {
      throw new SurfaceAgentHttpError(
        "SESSION_NOT_ACTIVE",
        "The selected DSH Session has no live Agent",
        409,
      );
    }

    this.#leases.get(input.clientId)?.dispose();
    const sessionLease = this.#bySession.get(input.sessionId);
    if (sessionLease && sessionLease.input.clientId !== input.clientId) {
      throw new SurfaceAgentHttpError(
        "LEASE_CONTENDED",
        "Another browser tab currently owns this DSH Session Surface lease",
        409,
      );
    }
    const lease = new SurfaceAgentHostLease(
      input,
      (transport) =>
        this.broker.bind(
          agent,
          surfaceOwner(input),
          input.tools as BrowserToolDescriptorPort[],
          transport,
        ),
      () => {
        if (this.#leases.get(input.clientId) === lease) {
          this.#leases.delete(input.clientId);
        }
        if (this.#bySession.get(input.sessionId) === lease) {
          this.#bySession.delete(input.sessionId);
        }
      },
    );
    this.#leases.set(input.clientId, lease);
    this.#bySession.set(input.sessionId, lease);
    return {
      active: true,
      token: lease.token,
      ttlMs: SURFACE_AGENT_LEASE_TTL_MS,
    };
  }

  #requireLease(input: SurfaceAgentPollRequest): SurfaceAgentHostLease {
    const lease = this.#leases.get(input.clientId);
    if (
      !lease ||
      lease.revision !== input.revision ||
      !sameCapabilityToken(lease.token, input.token)
    ) {
      throw new SurfaceAgentHttpError(
        "LEASE_NOT_ACTIVE",
        "The Surface Agent lease is no longer active",
        409,
      );
    }
    lease.touch();
    return lease;
  }
}

class SurfaceAgentHostLease {
  readonly revision: number;
  readonly token = randomBytes(32).toString("base64url");
  readonly #pending = new Map<string, PendingInvocation>();
  readonly #queue: SurfaceAgentInvocation[] = [];
  readonly #toolLease: BrowserToolLeasePort;
  #waiter:
    | {
        resolve(value: SurfaceAgentInvocation | null): void;
        dispose(): void;
      }
    | undefined;
  #disposed = false;
  #expiryTimer: ReturnType<typeof setTimeout>;

  constructor(
    readonly input: SurfaceAgentLeaseRequest,
    bind: (transport: {
      invoke(
        call: SurfaceAgentInvocation,
        signal: AbortSignal,
      ): Promise<string>;
    }) => BrowserToolLeasePort,
    private readonly onDispose: () => void,
  ) {
    this.revision = input.revision;
    this.#toolLease = bind({
      invoke: (call, signal) => this.#invoke(call, signal),
    });
    this.#expiryTimer = setTimeout(
      () => this.dispose(),
      SURFACE_AGENT_LEASE_TTL_MS,
    );
  }

  touch(): void {
    if (this.#disposed) return;
    clearTimeout(this.#expiryTimer);
    this.#expiryTimer = setTimeout(
      () => this.dispose(),
      SURFACE_AGENT_LEASE_TTL_MS,
    );
  }

  poll(signal: AbortSignal): Promise<SurfaceAgentInvocation | null> {
    if (this.#disposed) {
      return Promise.reject(new Error("Surface Agent lease is disposed"));
    }
    const queued = this.#queue.shift();
    if (queued) return Promise.resolve(queued);
    const prior = this.#waiter;
    this.#waiter = undefined;
    prior?.resolve(null);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: SurfaceAgentInvocation | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (this.#waiter?.resolve === finish) this.#waiter = undefined;
        resolve(value);
      };
      const onAbort = () => finish(null);
      const timer = setTimeout(() => finish(null), 20_000);
      signal.addEventListener("abort", onAbort, { once: true });
      this.#waiter = {
        resolve: finish,
        dispose: () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
        },
      };
    });
  }

  settle(input: SurfaceAgentResultRequest): void {
    const pending = this.#pending.get(input.callId);
    if (!pending) {
      throw new SurfaceAgentHttpError(
        "CALL_NOT_PENDING",
        "The browser Tool call is no longer pending",
        409,
      );
    }
    if (input.ok) pending.resolve(input.value ?? "");
    else
      pending.reject(new Error(input.error ?? "Browser Tool execution failed"));
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    clearTimeout(this.#expiryTimer);
    const waiter = this.#waiter;
    this.#waiter = undefined;
    waiter?.resolve(null);
    this.#queue.length = 0;
    for (const pending of this.#pending.values()) {
      pending.reject(new Error("Surface Agent lease was released"));
    }
    this.#pending.clear();
    this.#toolLease.dispose();
    this.onDispose();
  }

  #invoke(call: SurfaceAgentInvocation, signal: AbortSignal): Promise<string> {
    if (this.#disposed) {
      return Promise.reject(new Error("Surface Agent lease is not active"));
    }
    if (this.#pending.has(call.callId)) {
      return Promise.reject(
        new Error("Browser Tool call id is already pending"),
      );
    }
    return new Promise((resolve, reject) => {
      const settle = (operation: () => void) => {
        const pending = this.#pending.get(call.callId);
        if (!pending) return;
        signal.removeEventListener("abort", pending.onAbort);
        this.#pending.delete(call.callId);
        operation();
      };
      const onAbort = () =>
        settle(() => reject(new Error("Browser Tool call was aborted")));
      this.#pending.set(call.callId, {
        call,
        onAbort,
        resolve: (value) => settle(() => resolve(value)),
        reject: (error) => settle(() => reject(error)),
      });
      signal.addEventListener("abort", onAbort, { once: true });
      if (this.#waiter) {
        const waiter = this.#waiter;
        this.#waiter = undefined;
        waiter.resolve(call);
      } else {
        this.#queue.push(call);
      }
    });
  }
}

function surfaceOwner(input: SurfaceAgentLeaseRequest): string {
  return `surface.${input.surfaceId}.${input.clientId}`;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (
    request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !==
    "application/json"
  ) {
    throw new SurfaceAgentHttpError(
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type must be application/json",
      415,
    );
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > SURFACE_AGENT_MAX_BODY_BYTES) {
      throw new SurfaceAgentHttpError(
        "REQUEST_TOO_LARGE",
        "Surface Agent bridge request is too large",
        413,
      );
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new SurfaceAgentHttpError(
      "INVALID_JSON",
      "Surface Agent bridge request is not valid JSON",
      400,
    );
  }
}

function parseLease(value: unknown): SurfaceAgentLeaseRequest {
  const input = requireRecord(value);
  const tools = input.tools;
  if (!Array.isArray(tools) || tools.length > 32) {
    throw invalidInput("tools must be an array with at most 32 entries");
  }
  return {
    clientId: requireIdentifier(input.clientId, "clientId", 128),
    revision: requireRevision(input.revision),
    sessionId: requireIdentifier(input.sessionId, "sessionId", 256),
    surfaceId: requireIdentifier(input.surfaceId, "surfaceId", 64),
    scopeKey: requireIdentifier(input.scopeKey, "scopeKey", 128),
    label: requireString(input.label, "label", 128),
    tools: tools.map((tool) => {
      const descriptor = requireRecord(tool);
      const parameters = requireRecord(descriptor.parameters);
      return {
        name: requireToolName(descriptor.name),
        description: requireString(
          descriptor.description,
          "tool description",
          512,
        ),
        parameters,
      };
    }),
  };
}

function parsePoll(value: unknown): SurfaceAgentPollRequest {
  const input = requireRecord(value);
  return {
    clientId: requireIdentifier(input.clientId, "clientId", 128),
    revision: requireRevision(input.revision),
    token: requireToken(input.token),
  };
}

function parseRelease(value: unknown): SurfaceAgentReleaseRequest {
  return parsePoll(value);
}

function parseResult(value: unknown): SurfaceAgentResultRequest {
  const input = requireRecord(value);
  const poll = parsePoll(input);
  if (typeof input.ok !== "boolean") throw invalidInput("ok must be boolean");
  return {
    ...poll,
    callId: requireString(input.callId, "callId", 256),
    ok: input.ok,
    ...(input.value === undefined
      ? {}
      : { value: requireString(input.value, "value", 128 * 1024) }),
    ...(input.error === undefined
      ? {}
      : { error: requireString(input.error, "error", 2048) }),
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidInput("request must be an object");
  }
  return value as Record<string, unknown>;
}

function requireIdentifier(
  value: unknown,
  name: string,
  maximum: number,
): string {
  const text = requireString(value, name, maximum);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(text)) {
    throw invalidInput(`${name} is invalid`);
  }
  return text;
}

function requireToolName(value: unknown): string {
  const name = requireString(value, "tool name", 64);
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) {
    throw invalidInput("tool name is invalid");
  }
  return name;
}

function requireString(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw invalidInput(`${name} is invalid`);
  }
  return value;
}

function requireRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw invalidInput("revision must be a positive integer");
  }
  return value as number;
}

function requireToken(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(value)) {
    throw invalidInput("token is invalid");
  }
  return value;
}

function sameCapabilityToken(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.byteLength === rightBuffer.byteLength &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function invalidInput(message: string): SurfaceAgentHttpError {
  return new SurfaceAgentHttpError("INVALID_INPUT", message, 400);
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: SurfaceAgentEnvelope<unknown> | SurfaceAgentErrorEnvelope,
): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(body);
}
