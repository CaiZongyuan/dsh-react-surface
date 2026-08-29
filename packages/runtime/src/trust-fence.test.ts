import { describe, expect, test } from "bun:test";
import type { IncomingMessage } from "node:http";

import {
  isLoopbackAddress,
  isLoopbackHostname,
  isSurfaceHostRequestAllowed,
} from "./trust-fence.ts";

function request(
  remoteAddress: string,
  headers: Record<string, string> = {
    host: "127.0.0.1:14567",
    origin: "http://127.0.0.1:14567",
    "sec-fetch-site": "same-origin",
  },
): IncomingMessage {
  return {
    headers,
    socket: { remoteAddress },
  } as unknown as IncomingMessage;
}

describe("Surface Host trust fence", () => {
  test("accepts the complete loopback range", () => {
    expect(isLoopbackAddress("127.42.1.9")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("localhost")).toBe(true);
  });

  test("rejects remote sockets, non-loopback hosts, and cross-site browsers", () => {
    expect(isSurfaceHostRequestAllowed({}, request("192.168.1.5"))).toBe(false);
    expect(
      isSurfaceHostRequestAllowed(
        {},
        request("127.0.0.1", { host: "example.com" }),
      ),
    ).toBe(false);
    expect(
      isSurfaceHostRequestAllowed(
        {},
        request("127.0.0.1", {
          host: "127.0.0.1:14567",
          "sec-fetch-site": "cross-site",
        }),
      ),
    ).toBe(false);
  });

  test("accepts a remote request only through a live pairing adapter", () => {
    const remote = request("192.168.1.5", { host: "192.168.1.5:14567" });
    expect(
      isSurfaceHostRequestAllowed(
        { get: () => ({ isPairedDevice: () => true }) },
        remote,
      ),
    ).toBe(true);
  });
});
