export const SURFACE_AGENT_PATH = "/react-surface-agent";
export const SURFACE_AGENT_MAX_BODY_BYTES = 256 * 1024;
export const SURFACE_AGENT_LEASE_TTL_MS = 45_000;

export interface SurfaceAgentCapabilities {
  available: true;
  protocolVersion: 1;
  features: readonly ["capability-token", "lease-ttl", "session-scoped-tools"];
}

export interface SurfaceAgentToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface SurfaceAgentLeaseRequest {
  clientId: string;
  revision: number;
  sessionId: string;
  surfaceId: string;
  scopeKey: string;
  label: string;
  tools: SurfaceAgentToolDescriptor[];
}

export interface SurfaceAgentPollRequest {
  clientId: string;
  revision: number;
  token: string;
}

export interface SurfaceAgentLeaseResponse {
  active: true;
  token: string;
  ttlMs: number;
}

export interface SurfaceAgentInvocation {
  callId: string;
  name: string;
  arguments: unknown;
}

export interface SurfaceAgentResultRequest extends SurfaceAgentPollRequest {
  callId: string;
  ok: boolean;
  value?: string;
  error?: string;
}

export type SurfaceAgentReleaseRequest = SurfaceAgentPollRequest;

export interface SurfaceAgentEnvelope<T> {
  data: T;
}

export interface SurfaceAgentErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}
