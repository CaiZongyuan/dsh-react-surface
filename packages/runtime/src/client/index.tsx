import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { SidebarFooterActionOwnerProps } from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";

import type { ReactSurfaceRegistry } from "./contracts.ts";
import {
  defineReactSurface,
  getReactSurfaceLayoutConfiguration,
  validateSurfaceDefinition,
} from "./contracts.ts";
import { activateSurfaceBrandSlots } from "./brand-slots.tsx";
import { ReactSurfaceRegistryImpl } from "./registry.ts";
import { ReactSurfaceHost } from "./surface-host.tsx";
import { SurfaceLauncher } from "./surface-launcher.tsx";

export type {
  ReactSurfaceDefinition,
  ReactSurfaceAgentController,
  ReactSurfaceAgentCapability,
  ReactSurfaceAgentRegistration,
  ReactSurfaceAgentStatus,
  ReactSurfaceAgentTool,
  ReactSurfaceBranding,
  ReactSurfaceBrandTokens,
  ReactSurfaceCapabilities,
  ReactSurfaceDiagnostics,
  ReactSurfaceLayout,
  ReactSurfaceLayoutConfiguration,
  ReactSurfaceLayoutDeclaration,
  ReactSurfaceLifecycle,
  ReactSurfaceProps,
  ReactSurfaceRegistry,
  ReactSurfaceRuntimeSnapshot,
  ReactSurfaceShellDiagnostics,
  ReactSurfaceSizeConstraint,
  ReactSurfaceSnapshot,
  RegisteredReactSurface,
} from "./contracts.ts";
import { SurfaceAgentClientBridge } from "./surface-agent-client.ts";
import {
  REACT_SURFACE_FEATURES,
  REACT_SURFACE_INTERFACE_VERSION,
  REACT_SURFACE_RUNTIME_VERSION,
} from "./runtime-metadata.ts";
import { createBrowserSurfacePreferences } from "./surface-preferences.ts";
export {
  defineReactSurface,
  getReactSurfaceLayoutConfiguration,
  REACT_SURFACE_FEATURES,
  REACT_SURFACE_INTERFACE_VERSION,
  REACT_SURFACE_RUNTIME_VERSION,
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
  const registry = new ReactSurfaceRegistryImpl(
    createBrowserSurfacePreferences(),
  );
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
    const disposeBrandSlots = activateSurfaceBrandSlots(ctx, registry);

    return () => {
      disposeBrandSlots();
      disposeLauncher();
      disposeOverlay();
      agentBridge.dispose();
      registry.dispose();
      void disposeService();
    };
  }, "dsh-react-surface: runtime, overlay, and launcher");
}
