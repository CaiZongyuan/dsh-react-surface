import { useEffect, useRef, useState } from "react";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import {
  defineReactSurface,
  type ReactSurfaceProps,
} from "dsh-react-surface/client";

const styles = `
:host {
  background: var(--dsh-surface-background);
  color: var(--dsh-surface-foreground);
}
.tool-shell {
  display: grid;
  grid-template-rows: 52px minmax(0, 1fr);
  height: 100%;
}
.tool-header {
  align-items: center;
  background: var(--dsh-surface-surface);
  border-bottom: 1px solid var(--dsh-surface-border);
  display: flex;
  gap: 10px;
  padding: 0 16px;
}
.tool-header strong { font-size: 14px; }
.tool-status {
  align-items: center;
  color: var(--dsh-surface-muted-foreground);
  display: inline-flex;
  font-size: 12px;
  gap: 6px;
  margin-left: auto;
}
.tool-status::before {
  background: #7a8494;
  border-radius: 50%;
  content: "";
  height: 7px;
  width: 7px;
}
.tool-status[data-active]::before { background: #20875a; }
.tool-main {
  align-content: center;
  display: grid;
  justify-items: center;
  min-height: 0;
  padding: 20px;
}
.counter {
  background: var(--dsh-surface-surface);
  border: 1px solid var(--dsh-surface-border);
  border-radius: var(--dsh-surface-radius);
  display: grid;
  gap: 18px;
  max-width: 420px;
  padding: 22px;
  width: 100%;
}
.counter output {
  font-size: 52px;
  font-variant-numeric: tabular-nums;
  font-weight: 650;
  line-height: 1;
  text-align: center;
}
.counter-actions {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.counter button, .close {
  background: transparent;
  border: 1px solid var(--dsh-surface-border);
  border-radius: var(--dsh-surface-radius);
  color: inherit;
  cursor: pointer;
  font: inherit;
  height: 34px;
}
.close { width: 34px; }
@container dsh-react-surface-content (max-width: 420px) {
  .tool-main { padding: 12px; }
  .counter { padding: 16px; }
}
`;

function AgentToolsSurface({ agent, capabilities, close }: ReactSurfaceProps) {
  const [count, setCount] = useState(0);
  const countRef = useRef(count);
  countRef.current = count;

  useEffect(
    () =>
      agent.register({
        scopeKey: "counter:shared",
        label: "Shared counter",
        tools: [
          {
            name: "surface_counter_read",
            description:
              "Read the current counter value from the active Surface.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            execute: () => JSON.stringify({ count: countRef.current }),
          },
          {
            name: "surface_counter_set",
            description: "Set the counter value in the active Surface.",
            parameters: {
              type: "object",
              properties: {
                value: { type: "integer", minimum: -999, maximum: 999 },
              },
              required: ["value"],
              additionalProperties: false,
            },
            execute: (input) => {
              const value = readCounterValue(input);
              setCount(value);
              return JSON.stringify({ count: value });
            },
          },
        ],
      }),
    [agent],
  );

  const agentActive = capabilities.agent.status === "active";
  return (
    <div className="tool-shell">
      <header className="tool-header">
        <strong>Agent Tools</strong>
        <span
          className="tool-status"
          data-active={agentActive ? "" : undefined}
        >
          {capabilities.agent.status}
        </span>
        <button
          className="close"
          type="button"
          aria-label="Close Surface"
          onClick={close}
        >
          X
        </button>
      </header>
      <main className="tool-main">
        <section className="counter" aria-label="Shared counter">
          <output aria-live="polite">{count}</output>
          <div className="counter-actions">
            <button
              type="button"
              aria-label="Decrease"
              onClick={() => setCount((value) => value - 1)}
            >
              -
            </button>
            <button type="button" onClick={() => setCount(0)}>
              Reset
            </button>
            <button
              type="button"
              aria-label="Increase"
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

function readCounterValue(input: unknown): number {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Counter input must be an object");
  }
  const value = (input as Record<string, unknown>).value;
  if (
    !Number.isInteger(value) ||
    (value as number) < -999 ||
    (value as number) > 999
  ) {
    throw new TypeError(
      "Counter value must be an integer between -999 and 999",
    );
  }
  return value as number;
}

const definition = defineReactSurface({
  id: "example.ag-ui-tools",
  title: "Agent Tools",
  description: "Optional native DSH Agent control of browser-owned state",
  component: AgentToolsSurface,
  styles,
  layout: {
    default: "workspace",
    supported: ["workspace", "right-panel", "full-frame"],
    fallback: "full-frame",
  },
  branding: {
    shell: "surface",
    identity: {
      name: "Agent Tools",
      mark: "AT",
    },
    tokens: {
      accent: "#176b4d",
      accentForeground: "#ffffff",
      background: "#f6f8f7",
      border: "#d7dfdb",
      elevated: "#e9efec",
      foreground: "#202723",
      mutedForeground: "#66736c",
      surface: "#ffffff",
    },
  },
});

export const inject = ["reactSurfaces"];

export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.reactSurfaces.register(definition),
    "ag-ui-tools: register React application",
  );
}
