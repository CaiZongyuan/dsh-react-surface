/** Host loader entry for React Surface layout and optional native Agent leases. */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-host-webserver";

import { SurfaceAgentHost } from "./agent-host.ts";

export function apply(ctx: Context): void {
  ctx.inject(["webServer", "agents", "browserTools"], (bridgeCtx) => {
    new SurfaceAgentHost(
      bridgeCtx,
      bridgeCtx.get("browserTools") as ConstructorParameters<
        typeof SurfaceAgentHost
      >[1],
    );
  });
}
