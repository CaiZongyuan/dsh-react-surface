import type { Context as ClientContext } from "@deepseek-ai/cordis";

import {
  SURFACE_AGENT_PATH,
  type SurfaceAgentCapabilities,
  type SurfaceAgentEnvelope,
  type SurfaceAgentInvocation,
  type SurfaceAgentLeaseRequest,
  type SurfaceAgentLeaseResponse,
  type SurfaceAgentPollRequest,
  type SurfaceAgentReleaseRequest,
  type SurfaceAgentResultRequest,
  type SurfaceAgentToolDescriptor,
} from "../agent-protocol.ts";
import type { ReactSurfaceAgentRegistration } from "./contracts.ts";
import type { ReactSurfaceRegistryImpl } from "./registry.ts";

interface ActiveLease {
  readonly key: string;
  readonly revision: number;
  readonly sessionId: string;
  readonly surfaceId: string;
  readonly token: string;
  readonly poll: AbortController;
}

interface ClientSessionsPort {
  readonly list: {
    getSnapshot(): { current: string | undefined };
    subscribe(listener: () => void): () => void;
  };
}

interface BrowserLockManagerPort {
  request(
    name: string,
    options: { mode: "exclusive"; signal: AbortSignal },
    callback: () => Promise<void>,
  ): Promise<void>;
}

interface Leadership {
  readonly key: string;
  readonly lockName: string;
  readonly generation: number;
  readonly abort: AbortController;
  readonly hold: Promise<void>;
  release(): void;
  acquired: boolean;
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
  readonly #sessions: ClientSessionsPort;
  #active: ActiveLease | null = null;
  #leadership: Leadership | null = null;
  #availability: boolean | null = null;
  #lastAvailabilityProbe = 0;
  #revision = 0;
  #generation = 0;
  #syncQueued = false;
  #syncRunning = false;
  #syncRequested = false;
  #disposed = false;

  constructor(
    private readonly ctx: ClientContext,
    private readonly registry: ReactSurfaceRegistryImpl,
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
    this.#stopLeadership();
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
    if (!surfaceId || !registration) {
      this.#stopLeadership();
      await this.#release();
      if (this.#availability === true) {
        this.#setCapability(true, "idle");
      }
      return;
    }

    if (!(await this.#ensureAvailability())) return;
    if (this.#disposed || generation !== this.#generation) return;
    if (!sessionId) {
      this.#stopLeadership();
      await this.#release();
      this.#setCapability(
        true,
        "idle",
        "Select a native DSH Session to activate Surface Agent Tools",
      );
      return;
    }

    const tools = descriptors(registration);
    const identity = JSON.stringify({
      sessionId,
      surfaceId,
      scopeKey: registration.scopeKey,
    });
    const key = JSON.stringify({ identity, label: registration.label, tools });
    if (this.#leadership?.key === key) return;

    this.#stopLeadership();
    await this.#release();
    if (this.#disposed || generation !== this.#generation) return;

    const input: SurfaceAgentLeaseRequest = {
      clientId: this.#clientId,
      revision: ++this.#revision,
      sessionId,
      surfaceId,
      scopeKey: registration.scopeKey,
      label: registration.label,
      tools,
    };
    const leadership = createLeadership(
      key,
      `dsh-react-surface:${identity}`,
      generation,
    );
    this.#leadership = leadership;
    this.#setCapability(true, "connecting");
    this.#startLeadership(leadership, input);
  }

  #startLeadership(
    leadership: Leadership,
    input: SurfaceAgentLeaseRequest,
  ): void {
    const locks = getBrowserLocks();
    if (!locks) {
      void this.#runAsLeader(leadership, input);
      return;
    }

    const contentionTimer = setTimeout(() => {
      if (this.#leadership === leadership && !leadership.acquired) {
        this.#setCapability(
          true,
          "contended",
          "Another browser tab currently owns this Surface session",
        );
      }
    }, 150);
    void locks
      .request(
        leadership.lockName,
        { mode: "exclusive", signal: leadership.abort.signal },
        async () => {
          clearTimeout(contentionTimer);
          if (!this.#isCurrentLeadership(leadership)) return;
          leadership.acquired = true;
          await this.#runAsLeader(leadership, input);
        },
      )
      .catch((error: unknown) => {
        clearTimeout(contentionTimer);
        if (leadership.abort.signal.aborted || this.#disposed) return;
        this.#setCapability(
          true,
          "error",
          error instanceof Error ? error.message : "Browser leadership failed",
        );
        this.#retryLeadership(leadership);
      });
  }

  async #runAsLeader(
    leadership: Leadership,
    input: SurfaceAgentLeaseRequest,
  ): Promise<void> {
    if (!this.#isCurrentLeadership(leadership)) return;
    try {
      const response = await post<SurfaceAgentLeaseResponse>(
        `${SURFACE_AGENT_PATH}/lease`,
        input,
        leadership.abort.signal,
      );
      if (!this.#isCurrentLeadership(leadership)) {
        await releaseRemote(this.#clientId, input.revision, response.token);
        return;
      }
      const lease: ActiveLease = {
        key: leadership.key,
        revision: input.revision,
        sessionId: input.sessionId,
        surfaceId: input.surfaceId,
        token: response.token,
        poll: new AbortController(),
      };
      this.#active = lease;
      this.#setCapability(true, "active");
      void this.#poll(lease, leadership);
      await leadership.hold;
      await this.#release();
    } catch (error) {
      if (leadership.abort.signal.aborted || this.#disposed) return;
      this.#handleActivationError(error);
      this.#retryLeadership(leadership);
    }
  }

  #stopLeadership(): void {
    const leadership = this.#leadership;
    if (!leadership) return;
    this.#leadership = null;
    leadership.abort.abort();
    leadership.release();
  }

  async #release(): Promise<void> {
    const lease = this.#active;
    if (!lease) return;
    this.#active = null;
    lease.poll.abort();
    try {
      await releaseRemote(this.#clientId, lease.revision, lease.token);
    } catch (error) {
      if (!this.#disposed) {
        console.warn("Surface Agent lease release failed", error);
      }
    }
  }

  async #poll(lease: ActiveLease, leadership: Leadership): Promise<void> {
    while (!this.#disposed && this.#active === lease) {
      try {
        const result = await post<{
          invocation: SurfaceAgentInvocation | null;
        }>(
          `${SURFACE_AGENT_PATH}/poll`,
          {
            clientId: this.#clientId,
            revision: lease.revision,
            token: lease.token,
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
          this.#setCapability(
            true,
            "contended",
            "The Host lease was released or replaced",
          );
          leadership.release();
          this.#retryLeadership(leadership);
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
        lease.token,
        invocation.callId,
        "The application context changed before the Tool executed",
      );
    } else if (!tool) {
      result = failedResult(
        this.#clientId,
        lease.revision,
        lease.token,
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
          token: lease.token,
          callId: invocation.callId,
          ok: true,
          value,
        };
      } catch (error) {
        result = failedResult(
          this.#clientId,
          lease.revision,
          lease.token,
          invocation.callId,
          error instanceof Error ? error.message : "Application Tool failed",
        );
      }
    }
    await post<{ accepted: boolean }>(`${SURFACE_AGENT_PATH}/result`, result);
  }

  async #ensureAvailability(): Promise<boolean> {
    const now = Date.now();
    if (this.#availability === true) return true;
    if (
      this.#availability === false &&
      now - this.#lastAvailabilityProbe < 5_000
    ) {
      return false;
    }
    this.#lastAvailabilityProbe = now;
    try {
      await post<SurfaceAgentCapabilities>(
        `${SURFACE_AGENT_PATH}/capabilities`,
        {},
      );
      this.#availability = true;
      this.#setCapability(true, "idle");
      return true;
    } catch (error) {
      this.#availability = false;
      const reason =
        error instanceof SurfaceAgentResponseError && error.status === 404
          ? "dsh-ag-ui is not installed or its browser-tools service is unavailable"
          : error instanceof Error
            ? error.message
            : "dsh-ag-ui availability check failed";
      this.#setCapability(false, "unavailable", reason);
      return false;
    }
  }

  #handleActivationError(error: unknown): void {
    if (error instanceof SurfaceAgentResponseError) {
      if (error.code === "LEASE_CONTENDED") {
        this.#setCapability(true, "contended", error.message);
        return;
      }
      if (error.code === "SESSION_NOT_ACTIVE") {
        this.#setCapability(true, "idle", error.message);
        return;
      }
      if (error.status === 404) {
        this.#availability = false;
        this.#setCapability(false, "unavailable", error.message);
        return;
      }
    }
    this.#setCapability(
      true,
      "error",
      error instanceof Error
        ? error.message
        : "Surface Agent activation failed",
    );
  }

  #retryLeadership(leadership: Leadership): void {
    void abortableDelay(1_000, leadership.abort.signal).then(() => {
      if (!this.#isCurrentLeadership(leadership)) return;
      this.#leadership = null;
      leadership.release();
      this.#scheduleSync();
    });
  }

  #isCurrentLeadership(leadership: Leadership): boolean {
    return (
      !this.#disposed &&
      !leadership.abort.signal.aborted &&
      this.#leadership === leadership &&
      leadership.generation <= this.#generation
    );
  }

  #setCapability(
    available: boolean,
    status: import("./contracts.ts").ReactSurfaceAgentStatus,
    reason?: string,
  ): void {
    this.registry.setAgentCapability({
      available,
      status,
      ...(reason === undefined ? {} : { reason }),
    });
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
    const outer = JSON.parse(key) as { identity?: unknown };
    if (typeof outer.identity !== "string") return undefined;
    const identity = JSON.parse(outer.identity) as { scopeKey?: unknown };
    return typeof identity.scopeKey === "string"
      ? identity.scopeKey
      : undefined;
  } catch {
    return undefined;
  }
}

function failedResult(
  clientId: string,
  revision: number,
  token: string,
  callId: string,
  error: string,
): SurfaceAgentResultRequest {
  return { clientId, revision, token, callId, ok: false, error };
}

async function releaseRemote(
  clientId: string,
  revision: number,
  token: string,
): Promise<void> {
  await post<{ released: boolean }>(`${SURFACE_AGENT_PATH}/release`, {
    clientId,
    revision,
    token,
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
  const text = await response.text();
  let value:
    | SurfaceAgentEnvelope<T>
    | {
        error?: { code?: string; message?: string };
      };
  try {
    value = JSON.parse(text) as typeof value;
  } catch {
    throw new SurfaceAgentResponseError(
      response.status,
      "SURFACE_AGENT_INVALID_RESPONSE",
      `Surface Agent bridge returned ${response.status}`,
    );
  }
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

function createLeadership(
  key: string,
  lockName: string,
  generation: number,
): Leadership {
  let release = () => {};
  let released = false;
  const hold = new Promise<void>((resolve) => {
    release = () => {
      if (released) return;
      released = true;
      resolve();
    };
  });
  return {
    key,
    lockName,
    generation,
    abort: new AbortController(),
    hold,
    release,
    acquired: false,
  };
}

function getBrowserLocks(): BrowserLockManagerPort | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { locks?: BrowserLockManagerPort }).locks;
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
