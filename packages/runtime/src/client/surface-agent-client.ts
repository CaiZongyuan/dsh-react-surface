import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";

import {
  SURFACE_AGENT_PATH,
  type SurfaceAgentEnvelope,
  type SurfaceAgentInvocation,
  type SurfaceAgentLeaseRequest,
  type SurfaceAgentPollRequest,
  type SurfaceAgentReleaseRequest,
  type SurfaceAgentResultRequest,
  type SurfaceAgentToolDescriptor,
} from "../agent-protocol.ts";
import type {
  ReactSurfaceAgentRegistration,
  ReactSurfaceRegistry,
} from "./contracts.ts";

interface ActiveLease {
  readonly key: string;
  readonly revision: number;
  readonly sessionId: string;
  readonly surfaceId: string;
  readonly poll: AbortController;
}

interface ClientSessionsPort {
  readonly list: {
    getSnapshot(): { current: string | undefined };
    subscribe(listener: () => void): () => void;
  };
}

class SurfaceAgentResponseError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Browser half of the active-Surface/current-Session capability lease. */
export class SurfaceAgentClientBridge {
  readonly #clientId = `client-${crypto.randomUUID()}`;
  readonly #unsubscribeRegistry: () => void;
  readonly #unsubscribeSessions: () => void;
  #active: ActiveLease | null = null;
  #blockedKey: string | null = null;
  #revision = 0;
  #generation = 0;
  #syncQueued = false;
  #syncRunning = false;
  #syncRequested = false;
  #disposed = false;
  readonly #sessions: ClientSessionsPort;

  constructor(
    private readonly ctx: ClientContext,
    private readonly registry: ReactSurfaceRegistry,
  ) {
    this.#sessions = ctx.get("sessions") as unknown as ClientSessionsPort;
    this.#unsubscribeRegistry = registry.subscribe(() => this.#scheduleSync());
    this.#unsubscribeSessions = this.#sessions.list.subscribe(() =>
      this.#scheduleSync(),
    );
    this.#scheduleSync();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation += 1;
    this.#unsubscribeRegistry();
    this.#unsubscribeSessions();
    void this.#release();
  }

  #scheduleSync(): void {
    if (this.#disposed) return;
    this.#generation += 1;
    this.#syncRequested = true;
    if (this.#syncQueued || this.#syncRunning) return;
    this.#syncQueued = true;
    queueMicrotask(() => {
      this.#syncQueued = false;
      void this.#runSyncLoop();
    });
  }

  async #runSyncLoop(): Promise<void> {
    if (this.#syncRunning || this.#disposed) return;
    this.#syncRunning = true;
    try {
      while (this.#syncRequested && !this.#disposed) {
        this.#syncRequested = false;
        await this.#sync(this.#generation);
      }
    } finally {
      this.#syncRunning = false;
      if (this.#syncRequested) this.#scheduleSync();
    }
  }

  async #sync(generation: number): Promise<void> {
    const snapshot = this.registry.getSnapshot();
    const surfaceId = snapshot.activeId;
    const sessionId = this.#sessions.list.getSnapshot().current;
    const registration = surfaceId
      ? this.registry.getAgentRegistration(surfaceId)
      : undefined;
    if (!surfaceId || !sessionId || !registration) {
      this.#blockedKey = null;
      await this.#release();
      return;
    }

    const tools = descriptors(registration);
    const key = JSON.stringify({
      sessionId,
      surfaceId,
      scopeKey: registration.scopeKey,
      label: registration.label,
      tools,
    });
    if (this.#active?.key === key) return;
    if (this.#blockedKey === key) return;
    this.#blockedKey = null;

    await this.#release();
    if (this.#disposed || generation !== this.#generation) return;
    const revision = ++this.#revision;
    const input: SurfaceAgentLeaseRequest = {
      clientId: this.#clientId,
      revision,
      sessionId,
      surfaceId,
      scopeKey: registration.scopeKey,
      label: registration.label,
      tools,
    };
    try {
      await post<{ active: boolean }>(`${SURFACE_AGENT_PATH}/lease`, input);
    } catch (error) {
      this.#retry(error, generation);
      return;
    }
    if (this.#disposed || generation !== this.#generation) {
      await releaseRemote(this.#clientId, revision);
      return;
    }

    const lease: ActiveLease = {
      key,
      revision,
      sessionId,
      surfaceId,
      poll: new AbortController(),
    };
    this.#active = lease;
    this.#blockedKey = null;
    void this.#poll(lease);
  }

  async #release(): Promise<void> {
    const lease = this.#active;
    if (!lease) return;
    this.#active = null;
    lease.poll.abort();
    try {
      await releaseRemote(this.#clientId, lease.revision);
    } catch (error) {
      if (!this.#disposed)
        console.warn("Surface Agent lease release failed", error);
    }
  }

  async #poll(lease: ActiveLease): Promise<void> {
    while (!this.#disposed && this.#active === lease) {
      try {
        const result = await post<{
          invocation: SurfaceAgentInvocation | null;
        }>(
          `${SURFACE_AGENT_PATH}/poll`,
          {
            clientId: this.#clientId,
            revision: lease.revision,
          } satisfies SurfaceAgentPollRequest,
          lease.poll.signal,
        );
        if (!result.invocation || this.#active !== lease) continue;
        await this.#execute(lease, result.invocation);
      } catch (error) {
        if (lease.poll.signal.aborted || this.#active !== lease) return;
        if (
          error instanceof SurfaceAgentResponseError &&
          error.code === "LEASE_NOT_ACTIVE"
        ) {
          this.#active = null;
          this.#blockedKey = lease.key;
          return;
        }
        console.warn("Surface Agent polling failed", error);
        await abortableDelay(1_000, lease.poll.signal);
      }
    }
  }

  async #execute(
    lease: ActiveLease,
    invocation: SurfaceAgentInvocation,
  ): Promise<void> {
    const registration = this.registry.getAgentRegistration(lease.surfaceId);
    const tool = registration?.tools.find(
      (candidate) => candidate.name === invocation.name,
    );
    let result: SurfaceAgentResultRequest;
    if (!registration || registration.scopeKey !== parseScopeKey(lease.key)) {
      result = failedResult(
        this.#clientId,
        lease.revision,
        invocation.callId,
        "The application context changed before the Tool executed",
      );
    } else if (!tool) {
      result = failedResult(
        this.#clientId,
        lease.revision,
        invocation.callId,
        "The application no longer provides this Tool",
      );
    } else {
      try {
        const value = await tool.execute(
          invocation.arguments,
          lease.poll.signal,
        );
        result = {
          clientId: this.#clientId,
          revision: lease.revision,
          callId: invocation.callId,
          ok: true,
          value,
        };
      } catch (error) {
        result = failedResult(
          this.#clientId,
          lease.revision,
          invocation.callId,
          error instanceof Error ? error.message : "Application Tool failed",
        );
      }
    }
    await post<{ accepted: boolean }>(`${SURFACE_AGENT_PATH}/result`, result);
  }

  #retry(error: unknown, generation: number): void {
    if (this.#disposed || generation !== this.#generation) return;
    if (
      !(error instanceof SurfaceAgentResponseError) ||
      error.code !== "SESSION_NOT_ACTIVE"
    ) {
      console.warn("Surface Agent activation failed", error);
    }
    setTimeout(() => {
      if (!this.#disposed && generation === this.#generation) {
        this.#scheduleSync();
      }
    }, 1_000);
  }
}

function descriptors(
  registration: ReactSurfaceAgentRegistration,
): SurfaceAgentToolDescriptor[] {
  return registration.tools.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
}

function parseScopeKey(key: string): string | undefined {
  try {
    const value = JSON.parse(key) as { scopeKey?: unknown };
    return typeof value.scopeKey === "string" ? value.scopeKey : undefined;
  } catch {
    return undefined;
  }
}

function failedResult(
  clientId: string,
  revision: number,
  callId: string,
  error: string,
): SurfaceAgentResultRequest {
  return { clientId, revision, callId, ok: false, error };
}

async function releaseRemote(
  clientId: string,
  revision: number,
): Promise<void> {
  await post<{ released: boolean }>(`${SURFACE_AGENT_PATH}/release`, {
    clientId,
    revision,
  } satisfies SurfaceAgentReleaseRequest);
}

async function post<T>(
  path: string,
  body: object,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
  const value = (await response.json()) as
    SurfaceAgentEnvelope<T> | { error?: { code?: string; message?: string } };
  if (!response.ok || !("data" in value)) {
    const error = "error" in value ? value.error : undefined;
    throw new SurfaceAgentResponseError(
      response.status,
      error?.code ?? "SURFACE_AGENT_REQUEST_FAILED",
      error?.message ?? "Surface Agent request failed",
    );
  }
  return value.data;
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}
