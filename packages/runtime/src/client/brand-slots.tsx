import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {
  SidebarBrandMarkOwnerProps,
  SidebarBrandNameOwnerProps,
} from "@deepseek-ai/dsh-client-ui-sidebar/client";

import type { ReactSurfaceBranding } from "./contracts.ts";
import type { ReactSurfaceRegistry } from "./contracts.ts";

/** Register official Sidebar brand occupants only while a branded Surface is active. */
export function activateSurfaceBrandSlots(
  ctx: ClientContext,
  registry: ReactSurfaceRegistry,
): () => void {
  let activeKey: string | null = null;
  let disposeActive = () => {};

  const sync = () => {
    const snapshot = registry.getSnapshot();
    const active = snapshot.surfaces.find(
      ({ definition }) => definition.id === snapshot.activeId,
    );
    const identity =
      active?.definition.branding?.shell === "surface"
        ? active.definition.branding.identity
        : undefined;
    const nextKey = identity
      ? `${active?.definition.id}\0${identity.mark ?? ""}\0${identity.name}`
      : null;
    if (activeKey === nextKey) return;
    disposeActive();
    disposeActive = () => {};
    activeKey = nextKey;
    if (!identity) return;

    const BrandMark = createBrandMark(identity);
    const BrandName = createBrandName(identity);
    const disposeMark = ctx.slots.inject("sidebar.brand.mark", () =>
      ctx.slots.register(
        {
          name: "sidebar.brand.mark",
          priority: -100,
          registrant: "dsh-react-surface",
        },
        BrandMark,
      ),
    );
    const disposeName = ctx.slots.inject("sidebar.brand.name", () =>
      ctx.slots.register(
        {
          name: "sidebar.brand.name",
          priority: -100,
          registrant: "dsh-react-surface",
        },
        BrandName,
      ),
    );
    disposeActive = () => {
      disposeName();
      disposeMark();
    };
  };

  const unsubscribe = registry.subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    disposeActive();
  };
}

function createBrandMark(
  identity: NonNullable<ReactSurfaceBranding["identity"]>,
) {
  return function SurfaceBrandMark({ size }: SidebarBrandMarkOwnerProps) {
    return (
      <span
        data-dsh-react-surface-brand-mark=""
        style={{
          alignItems: "center",
          background:
            "var(--dsh-surface-accent, var(--dsw-alias-brand-primary, #2367d1))",
          borderRadius: "var(--dsh-surface-radius, 6px)",
          color:
            "var(--dsh-surface-accent-foreground, var(--dsw-alias-brand-primary-invert, #fff))",
          display: "inline-flex",
          flex: "0 0 auto",
          fontFamily:
            "var(--dsh-surface-font-family, var(--dsw-font-family, system-ui))",
          fontSize: Math.max(9, Math.round(size * 0.38)),
          fontWeight: 700,
          height: size,
          justifyContent: "center",
          letterSpacing: 0,
          width: size,
        }}
      >
        {identity.mark ?? identity.name.slice(0, 2)}
      </span>
    );
  };
}

function createBrandName(
  identity: NonNullable<ReactSurfaceBranding["identity"]>,
) {
  return function SurfaceBrandName(_props: SidebarBrandNameOwnerProps) {
    return (
      <span
        data-dsh-react-surface-brand-name=""
        style={{
          color:
            "var(--dsh-surface-foreground, var(--dsw-alias-label-primary, currentColor))",
          fontFamily:
            "var(--dsh-surface-font-family, var(--dsw-font-family, system-ui))",
          fontSize: 14,
          fontWeight: 650,
          letterSpacing: 0,
          whiteSpace: "nowrap",
        }}
      >
        {identity.name}
      </span>
    );
  };
}
