import { useSyncExternalStore } from "react";

import type { ReactSurfaceRegistry } from "./contracts.ts";

interface SurfaceLauncherProps {
  registry: ReactSurfaceRegistry;
  wide: boolean;
}

export function SurfaceLauncher({ registry, wide }: SurfaceLauncherProps) {
  const snapshot = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  );

  if (snapshot.surfaces.length === 0) return null;

  return (
    <div
      data-dsh-react-surface-launcher=""
      style={{
        display: "flex",
        flex: "1 1 auto",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
        padding: wide ? "4px 8px" : 4,
      }}
    >
      {snapshot.surfaces.map(({ definition }) => {
        const active = snapshot.activeId === definition.id;
        const label = active
          ? `Close ${definition.title}`
          : `Open ${definition.title}`;
        return (
          <button
            key={definition.id}
            type="button"
            aria-label={label}
            aria-pressed={active}
            title={wide ? undefined : label}
            onClick={() =>
              active ? registry.close() : registry.open(definition.id)
            }
            style={{
              alignItems: "center",
              background: active
                ? "var(--dsw-alias-interactive-bg-active, #e7e9ee)"
                : "transparent",
              border: 0,
              borderRadius: 6,
              color: "var(--dsw-alias-label-primary, #252730)",
              cursor: "pointer",
              display: "flex",
              font: "inherit",
              gap: 8,
              height: 34,
              justifyContent: wide ? "flex-start" : "center",
              minWidth: wide ? 0 : 34,
              padding: wide ? "0 8px" : 0,
              width: wide ? "100%" : 34,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                alignItems: "center",
                border: "1px solid var(--dsw-alias-border-l2, #d9dce3)",
                borderRadius: 5,
                display: "inline-flex",
                flex: "0 0 auto",
                fontSize: 10,
                fontWeight: 700,
                height: 22,
                justifyContent: "center",
                lineHeight: 1,
                width: 22,
              }}
            >
              {surfaceMark(definition.title)}
            </span>
            {wide ? (
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {definition.title}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function surfaceMark(title: string) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}
