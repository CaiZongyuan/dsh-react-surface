import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { SidebarFooterActionOwnerProps } from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";

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
import {
  NativeFileWidth,
  type NativeLayoutProps,
} from "./native-file-width.tsx";

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
import {
  SurfaceAgentClientBridge,
  type ClientSessionsPort,
} from "./surface-agent-client.ts";
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
  const SurfaceHostEntry = (props: NativeLayoutProps) => (
    <>
      {typeof props.useStore === "function" && (
        <NativeFileWidth
          {...props}
          registry={registry}
          useStore={props.useStore}
        />
      )}
      <ReactSurfaceHost registry={registry} />
    </>
  );
  const SurfaceLauncherEntry = ({ wide }: SidebarFooterActionOwnerProps) => (
    <SurfaceLauncher registry={registry} wide={wide} />
  );

  ctx.effect(() => {
    const disposeService = ctx.reflect.provide("reactSurfaces", registry);
    // Bind the optional Agent bridge to the injected service's lifetime. The
    // Surface host remains usable while the Session Controller is unavailable.
    const agentScope = ctx.inject(["sessions"], (sessionCtx) => {
      const sessions = (
        sessionCtx as unknown as { sessions: ClientSessionsPort }
      ).sessions;
      sessionCtx.effect(() => {
        const bridge = new SurfaceAgentClientBridge(sessions, registry);
        return () => {
          bridge.dispose();
          registry.setAgentCapability({
            available: false,
            status: "unavailable",
            reason: "DSH Session Controller is unavailable",
          });
        };
      }, "dsh-react-surface: session agent bridge");
    });
    const disposeOverlay = ctx.slots.inject("shell.overlay", () =>
      ctx.slots.register(
        {
          name: "shell.overlay",
          id: "dsh-react-surface-host",
          order: 100,
          label: "React application surfaces",
          store: ctx.slots.entries?.("root")[0]?.store,
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
      void agentScope.dispose();
      registry.dispose();
      void disposeService();
    };
  }, "dsh-react-surface: runtime, overlay, and launcher");
}
