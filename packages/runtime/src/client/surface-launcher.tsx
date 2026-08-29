import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import {
  getReactSurfaceLayoutConfiguration,
  type ReactSurfaceLayout,
  type ReactSurfaceRegistry,
} from "./contracts.ts";

interface SurfaceLauncherProps {
  registry: ReactSurfaceRegistry;
  wide: boolean;
}

const LAYOUT_LABELS: Readonly<Record<ReactSurfaceLayout, string>> = {
  "full-frame": "Full frame",
  center: "Center",
  workspace: "Workspace",
  "right-panel": "Right panel",
  "bottom-panel": "Bottom panel",
};

export function SurfaceLauncher({ registry, wide }: SurfaceLauncherProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const snapshot = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  );

  const hasSurfaces = snapshot.surfaces.length > 0;
  const active = snapshot.surfaces.find(
    ({ definition }) => definition.id === snapshot.activeId,
  );
  const label = active?.definition.title ?? "React applications";

  useEffect(() => {
    if (!menuOpen || !hasSurfaces) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [hasSurfaces, menuOpen]);

  if (!hasSurfaces) return null;

  return (
    <div
      data-dsh-react-surface-launcher=""
      style={{ minWidth: 0, padding: wide ? "4px 8px" : 4 }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label="Open React applications"
        title={wide ? undefined : label}
        onClick={() => setMenuOpen((open) => !open)}
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
        <SurfaceMark
          title={label}
          mark={active?.definition.branding?.identity?.mark}
          active={active !== undefined}
        />
        {wide ? (
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </span>
        ) : null}
      </button>
      {menuOpen && typeof document !== "undefined"
        ? createPortal(
            <SurfaceMenu
              registry={registry}
              surfaces={snapshot.surfaces}
              activeId={snapshot.activeId}
              anchor={buttonRef.current}
              onClose={() => setMenuOpen(false)}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

interface SurfaceMenuProps {
  registry: ReactSurfaceRegistry;
  surfaces: ReturnType<ReactSurfaceRegistry["getSnapshot"]>["surfaces"];
  activeId: string | null;
  anchor: HTMLButtonElement | null;
  onClose(): void;
}

function SurfaceMenu({
  registry,
  surfaces,
  activeId,
  anchor,
  onClose,
}: SurfaceMenuProps) {
  const anchorRect = anchor?.getBoundingClientRect();
  const left = Math.min(
    Math.max(8, (anchorRect?.right ?? 48) + 8),
    Math.max(8, window.innerWidth - 300),
  );
  const bottom = Math.max(8, window.innerHeight - (anchorRect?.bottom ?? 64));

  return (
    <div
      data-dsh-react-surface-menu-backdrop=""
      onPointerDown={onClose}
      style={{ inset: 0, position: "fixed", zIndex: 1000 }}
    >
      <div
        role="menu"
        aria-label="React applications"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
          anchor?.focus();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        style={{
          background:
            "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))",
          border: "1px solid var(--dsw-alias-border-l2, #d9dce3)",
          borderRadius: 8,
          bottom,
          boxShadow: "0 12px 32px rgba(0,0,0,.18)",
          color: "var(--dsw-alias-label-primary, #252730)",
          display: "grid",
          gap: 4,
          left,
          maxHeight: "min(520px, calc(100dvh - 24px))",
          overflowY: "auto",
          padding: 6,
          position: "fixed",
          width: 280,
        }}
      >
        {surfaces.map(({ definition, layout }) => {
          const active = definition.id === activeId;
          const layoutConfiguration =
            getReactSurfaceLayoutConfiguration(definition);
          return (
            <div
              key={definition.id}
              data-active={active ? "" : undefined}
              style={{
                background: active
                  ? "var(--dsw-alias-interactive-bg-active, #eef2ff)"
                  : "transparent",
                borderRadius: 6,
                display: "grid",
                gap: 6,
                padding: 6,
              }}
            >
              <button
                type="button"
                role="menuitem"
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  if (active) registry.close();
                  else registry.open(definition.id);
                  onClose();
                }}
                style={{
                  alignItems: "center",
                  background: "transparent",
                  border: 0,
                  color: "inherit",
                  cursor: "pointer",
                  display: "grid",
                  font: "inherit",
                  gap: 8,
                  gridTemplateColumns: "24px minmax(0, 1fr)",
                  padding: 0,
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <SurfaceMark
                  title={definition.title}
                  mark={definition.branding?.identity?.mark}
                  active={active}
                />
                <span style={{ minWidth: 0 }}>
                  <strong
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {definition.title}
                  </strong>
                  {definition.description ? (
                    <small
                      style={{
                        color: "var(--dsw-alias-label-secondary, #6b7280)",
                        display: "block",
                        fontSize: 11,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {definition.description}
                    </small>
                  ) : null}
                </span>
              </button>
              {active && layoutConfiguration.supported.length > 1 ? (
                <select
                  aria-label={`Layout for ${definition.title}`}
                  value={layout}
                  onChange={(event) =>
                    registry.setLayout(
                      definition.id,
                      event.currentTarget.value as ReactSurfaceLayout,
                    )
                  }
                  style={{
                    background: "var(--dsw-alias-bg-layer-1, #fff)",
                    border: "1px solid var(--dsw-alias-border-l2, #d9dce3)",
                    borderRadius: 5,
                    color: "inherit",
                    font: "inherit",
                    fontSize: 12,
                    height: 30,
                    marginLeft: 32,
                    minWidth: 0,
                    padding: "0 6px",
                  }}
                >
                  {layoutConfiguration.supported.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {LAYOUT_LABELS[candidate]}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SurfaceMark({
  title,
  mark: declaredMark,
  active,
}: {
  title: string;
  mark: string | undefined;
  active: boolean;
}) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const mark =
    declaredMark ??
    words
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("");
  return (
    <span
      aria-hidden="true"
      style={{
        alignItems: "center",
        background: active
          ? "var(--dsw-alias-brand-primary, #2367d1)"
          : "transparent",
        border: active
          ? "1px solid transparent"
          : "1px solid var(--dsw-alias-border-l2, #d9dce3)",
        borderRadius: 5,
        color: active
          ? "var(--dsw-alias-brand-primary-invert, #fff)"
          : "inherit",
        display: "inline-flex",
        flex: "0 0 auto",
        fontSize: 10,
        fontWeight: 700,
        height: 24,
        justifyContent: "center",
        lineHeight: 1,
        width: 24,
      }}
    >
      {mark}
    </span>
  );
}
