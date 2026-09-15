import { useLayoutEffect, useRef } from "react";
import type { ReactSurfaceRegistryImpl } from "./registry.ts";

export interface NativeLayoutProps {
  useStore?: (selector: (snapshot: unknown) => unknown) => unknown;
  actions?: unknown;
}

interface NativeLayout {
  rightbar: number | null;
  rightbarShown: boolean;
  rightbarFullscreen: boolean;
}

function readLayout(snapshot: unknown): NativeLayout | null {
  if (!snapshot || typeof snapshot !== "object" || !("layoutInfo" in snapshot))
    return null;
  const info = snapshot.layoutInfo;
  if (!info || typeof info !== "object") return null;
  if (
    !("rightbar" in info) ||
    !(
      info.rightbar === null ||
      (typeof info.rightbar === "number" && Number.isFinite(info.rightbar))
    ) ||
    !("rightbarShown" in info) ||
    typeof info.rightbarShown !== "boolean" ||
    !("rightbarFullscreen" in info) ||
    typeof info.rightbarFullscreen !== "boolean"
  )
    return null;
  return {
    rightbar: info.rightbar,
    rightbarShown: info.rightbarShown,
    rightbarFullscreen: info.rightbarFullscreen,
  };
}

// DSH 0.1.5-rc.2 shares the AppFrame store through its root slot seat.
// The renderer owns store creation; unsupported hosts keep their native sizing.
export function NativeFileWidth({
  useStore,
  actions,
  registry,
}: NativeLayoutProps & {
  useStore: NonNullable<NativeLayoutProps["useStore"]>;
  registry: ReactSurfaceRegistryImpl;
}) {
  const layout = readLayout(useStore((snapshot) => snapshot));
  const previous = useRef<NativeLayout | null>(null);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = layout;
    if (
      !before ||
      before.rightbar !== null ||
      before.rightbarShown ||
      !layout?.rightbarShown ||
      layout.rightbarFullscreen
    )
      return;
    const snapshot = registry.getSnapshot();
    const active = snapshot.surfaces.find(
      ({ definition }) => definition.id === snapshot.activeId,
    );
    if (active?.layout !== "workspace" || active.conversationCollapsed) return;
    if (
      actions &&
      typeof actions === "object" &&
      "setRightbar" in actions &&
      typeof actions.setRightbar === "function"
    ) {
      actions.setRightbar(360);
    }
  }, [layout, actions, registry]);
  return null;
}
