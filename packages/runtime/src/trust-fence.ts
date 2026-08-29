import type { IncomingMessage } from "node:http";

interface PairingAccess {
  isPairedDevice(request: IncomingMessage): boolean;
}

interface PairingContext {
  get?(name: string, strict?: boolean): unknown;
  remoteWebUiPairing?: PairingAccess;
}

/** Loopback or an explicitly live DSH remote-web pairing may enter Host routes. */
export function isSurfaceHostRequestAllowed(
  ctx: PairingContext,
  request: IncomingMessage,
): boolean {
  if (isLoopbackRequest(request)) return true;
  const candidate =
    typeof ctx.get === "function"
      ? ctx.get("remoteWebUiPairing", false)
      : ctx.remoteWebUiPairing;
  return isPairingAccess(candidate) && candidate.isPairedDevice(request);
}

export function isLoopbackRequest(request: IncomingMessage): boolean {
  if (!isLoopbackAddress(request.socket.remoteAddress)) return false;
  const host = request.headers.host;
  if (typeof host !== "string") return false;
  let hostUrl: URL;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false;
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false;
  const normalized = address.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) {
    return isIpv4Loopback(normalized.slice("::ffff:".length));
  }
  return isIpv4Loopback(normalized);
}

export function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "[::1]" || isIpv4Loopback(hostname)
  );
}

function isIpv4Loopback(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

function isPairingAccess(value: unknown): value is PairingAccess {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PairingAccess).isPairedDevice === "function"
  );
}
