import { useState } from "react";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import {
  defineReactSurface,
  type ReactSurfaceProps,
} from "dsh-react-surface/client";

const styles = `
:host {
  --surface-bg: #f7f8fa;
  --surface-panel: #ffffff;
  --surface-text: #252730;
  --surface-muted: #6b7280;
  --surface-border: #dfe3e8;
  --surface-accent: #2367d1;
  background: var(--surface-bg);
  color: var(--surface-text);
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}
.example-shell {
  display: grid;
  grid-template-rows: 56px minmax(0, 1fr);
  min-height: 100%;
  background: var(--surface-bg);
}
.example-header {
  align-items: center;
  background: var(--surface-panel);
  border-bottom: 1px solid var(--surface-border);
  display: flex;
  gap: 12px;
  padding: 0 18px;
}
.example-mark {
  align-items: center;
  background: var(--surface-text);
  border-radius: 6px;
  color: white;
  display: inline-flex;
  font-size: 12px;
  font-weight: 700;
  height: 30px;
  justify-content: center;
  width: 30px;
}
.example-header strong {
  font-size: 14px;
}
.example-header small {
  color: var(--surface-muted);
  display: block;
  font-size: 12px;
  margin-top: 1px;
}
.example-close {
  align-items: center;
  background: transparent;
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  color: var(--surface-text);
  cursor: pointer;
  display: inline-flex;
  font-size: 16px;
  height: 32px;
  justify-content: center;
  margin-left: auto;
  width: 32px;
}
.example-main {
  align-content: center;
  display: grid;
  justify-items: center;
  min-height: 0;
  padding: 24px;
}
.counter-tool {
  background: var(--surface-panel);
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  display: grid;
  gap: 20px;
  max-width: 420px;
  padding: 24px;
  width: 100%;
}
.counter-tool header {
  align-items: baseline;
  display: flex;
  justify-content: space-between;
}
.counter-tool h1 {
  font-size: 16px;
  margin: 0;
}
.counter-tool code {
  color: var(--surface-muted);
  font-size: 12px;
}
.counter-value {
  font-size: 48px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  line-height: 1;
  text-align: center;
}
.counter-actions {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(3, 1fr);
}
.counter-actions button {
  background: var(--surface-panel);
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  color: var(--surface-text);
  cursor: pointer;
  font: inherit;
  height: 36px;
}
.counter-actions button[data-primary] {
  background: var(--surface-accent);
  border-color: var(--surface-accent);
  color: white;
}
@container dsh-react-surface-content (max-width: 560px) {
  .example-main { padding: 14px; }
  .counter-tool { padding: 18px; }
}
`;

function BasicSurface({ location, navigate, close }: ReactSurfaceProps) {
  const [count, setCount] = useState(0);

  return (
    <div className="example-shell">
      <header className="example-header">
        <span className="example-mark" aria-hidden="true">
          RS
        </span>
        <div>
          <strong>React Surface</strong>
          <small>Independent example application</small>
        </div>
        <button
          type="button"
          className="example-close"
          aria-label="Return to DSH workspace"
          title="Return to DSH workspace"
          onClick={close}
        >
          X
        </button>
      </header>
      <main className="example-main">
        <section className="counter-tool" aria-labelledby="counter-title">
          <header>
            <h1 id="counter-title">Counter</h1>
            <code>{location}</code>
          </header>
          <output className="counter-value" aria-live="polite">
            {count}
          </output>
          <div className="counter-actions">
            <button
              type="button"
              aria-label="Decrease counter"
              onClick={() => setCount((value) => value - 1)}
            >
              -
            </button>
            <button
              type="button"
              aria-label="Reset counter"
              onClick={() => {
                setCount(0);
                navigate("/counter");
              }}
            >
              Reset
            </button>
            <button
              type="button"
              data-primary=""
              aria-label="Increase counter"
              onClick={() => setCount((value) => value + 1)}
            >
              +
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

const definition = defineReactSurface({
  id: "example.basic",
  title: "Basic Surface",
  description: "A branded React application with flexible DSH layouts",
  component: BasicSurface,
  styles,
  initialLocation: "/counter",
  layout: {
    default: "workspace",
    supported: [
      "full-frame",
      "center",
      "workspace",
      "right-panel",
      "bottom-panel",
    ],
    fallback: "full-frame",
    resizable: true,
    persist: true,
  },
  branding: {
    shell: "surface",
    colorScheme: "light",
    identity: {
      name: "React Surface",
      mark: "RS",
    },
    tokens: {
      accent: "#2367d1",
      accentForeground: "#ffffff",
      background: "#f7f8fa",
      border: "#dfe3e8",
      elevated: "#eef1f5",
      foreground: "#252730",
      mutedForeground: "#6b7280",
      surface: "#ffffff",
    },
  },
  lifecycle: {
    mount: "lazy",
    retention: "keep-alive",
  },
});

export const inject = ["reactSurfaces"];

export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.reactSurfaces.register(definition),
    "basic-surface: register React application",
  );
}
