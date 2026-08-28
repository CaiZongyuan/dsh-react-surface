import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { SidebarFooterActionOwnerProps } from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";

import type { ReactSurfaceRegistry } from "./contracts.ts";
import { defineReactSurface, validateSurfaceDefinition } from "./contracts.ts";
import { ReactSurfaceRegistryImpl } from "./registry.ts";
import { ReactSurfaceHost } from "./surface-host.tsx";
import { SurfaceLauncher } from "./surface-launcher.tsx";

export type {
  ReactSurfaceDefinition,
  ReactSurfaceAgentController,
  ReactSurfaceAgentRegistration,
  ReactSurfaceAgentTool,
  ReactSurfaceLayout,
  ReactSurfaceProps,
  ReactSurfaceRegistry,
  ReactSurfaceSnapshot,
  RegisteredReactSurface,
} from "./contracts.ts";
import { SurfaceAgentClientBridge } from "./surface-agent-client.ts";
export {
  defineReactSurface,
  ReactSurfaceRegistryImpl,
  validateSurfaceDefinition,
};

declare module "@deepseek-ai/cordis" {
  interface Context {
    reactSurfaces: ReactSurfaceRegistry;
  }
}

export const inject = ["slots"];

export function apply(ctx: ClientContext): void {
  const registry = new ReactSurfaceRegistryImpl();
  const agentBridge = new SurfaceAgentClientBridge(ctx, registry);
  const SurfaceHostEntry = () => <ReactSurfaceHost registry={registry} />;
  const SurfaceLauncherEntry = ({ wide }: SidebarFooterActionOwnerProps) => (
    <SurfaceLauncher registry={registry} wide={wide} />
  );

  ctx.effect(() => {
    const disposeService = ctx.reflect.provide("reactSurfaces", registry);
    const disposeOverlay = ctx.slots.inject("shell.overlay", () =>
      ctx.slots.register(
        {
          name: "shell.overlay",
          id: "dsh-react-surface-host",
          order: 100,
          label: "React application surfaces",
        },
        SurfaceHostEntry,
      ),
    );
    const disposeLauncher = ctx.slots.inject("sidebar.footer.action", () =>
      ctx.slots.register(
        {
          name: "sidebar.footer.action",
          id: "dsh-react-surface-launcher",
          order: 100,
          label: "React applications",
        },
        SurfaceLauncherEntry,
      ),
    );

    return () => {
      disposeLauncher();
      disposeOverlay();
      agentBridge.dispose();
      void disposeService();
    };
  }, "dsh-react-surface: runtime, overlay, and launcher");
}
