# dsh-react-surface

English | [简体中文](README.zh.md)

`dsh-react-surface` lets an existing client-side React application run as a native DeepSeek Harness surface. The application keeps its own UI and state, while the runtime owns DSH placement, lifecycle, style isolation, shell branding, responsive layouts, diagnostics, and optional Agent collaboration.

The repository currently targets DeepSeek Harness `0.1.1-rc.2` and is installed from source. It is not an npm release yet.

## What It Provides

- One typed `defineReactSurface(...)` entry for Vite React applications and Next.js Client Components.
- Isolated ShadowRoots with automatic CSS, CSS Module, image, and font bundling.
- `full-frame`, `center`, `workspace`, `right-panel`, and `bottom-panel` layouts.
- Accessible resize handles, responsive fallback, and versioned UI-only preferences.
- Surface-only styling or temporary semantic branding of the visible DSH shell.
- Lazy mount, keep-alive, and unmount-on-close lifecycle policies.
- A local diagnostic report through `ctx.reactSurfaces.inspect()`.
- Optional `dsh-ag-ui` browser Tools scoped to the active Surface and native DSH Session.

The runtime does not load arbitrary HTML, remote applications, iframes, or Next.js server output. Installed Surface plugins are trusted code; ShadowRoot is style isolation, not a security sandbox.

## Architecture

```text
DSH Web
├─ dsh-react-surface runtime
│  ├─ one small ctx.reactSurfaces interface
│  ├─ DSH Host Adapter: layout, branding, cleanup, compatibility
│  ├─ one ShadowRoot per mounted application
│  └─ optional dsh-ag-ui Session Tool lease
└─ application Adapter plugin
   ├─ imports the existing React root
   ├─ declares layouts, lifecycle, and brand tokens
   └─ optionally registers browser-owned Tools
```

Application Adapters never query DSH DOM or call DSH Slot primitives. They register through the runtime interface and keep ownership of routing, providers, data, authorization, and business behavior.

## Source Installation

Clone and verify the runtime:

```powershell
git clone https://github.com/CaiZongyuan/dsh-react-surface.git
cd dsh-react-surface
bun install
bun run check
```

Generate an Adapter inside an existing Vite or Next.js project:

```powershell
bun packages/build/src/cli.ts init D:\Projects\my-react-app --framework vite
```

The command creates `integrations/dsh` without overwriting application files. It detects a conventional Vite `src/App.tsx`; use `--entry`, `--id`, `--title`, `--output`, or `--dry-run` when the defaults do not fit.

Build and install the runtime and Adapter into the DSH Web profile:

```powershell
cd D:\Projects\my-react-app\integrations\dsh
bun install
bun run build

dsh.cmd plugin --profile web add D:\Projects\dsh-react-surface\packages\runtime
dsh.cmd plugin --profile web add D:\Projects\my-react-app\integrations\dsh
dsh.cmd web
```

Restart DSH after changing the installed package graph. Rebuild the Adapter and refresh the browser after changing Client code.

## Register A Surface

```tsx
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import {
  defineReactSurface,
  type ReactSurfaceProps,
} from "dsh-react-surface/client";

function Application({ close, layout, portalRoot }: ReactSurfaceProps) {
  return <YourExistingApplication />;
}

const definition = defineReactSurface({
  id: "acme.dashboard",
  title: "Acme Dashboard",
  description: "Operations workspace",
  component: Application,
  layout: {
    default: "workspace",
    supported: ["full-frame", "center", "workspace", "right-panel"],
    fallback: "full-frame",
    resizable: true,
    persist: true,
  },
  lifecycle: { mount: "lazy", retention: "keep-alive" },
});

export const inject = ["reactSurfaces"];

export function apply(ctx: ClientContext) {
  ctx.effect(() => ctx.reactSurfaces.register(definition));
}
```

The package manifest must declare the same Surface id under `dsh.reactSurface.id`. The build adapter uses it to attach extracted CSS to the correct ShadowRoot.

## Brand The Shell

An application can keep the stock DSH shell or coordinate it with the active product brand:

```ts
branding: {
  shell: "surface",
  colorScheme: "light",
  identity: { name: "Acme Dashboard", mark: "AD" },
  tokens: {
    accent: "#176b4d",
    accentForeground: "#ffffff",
    background: "#f6f8f7",
    surface: "#ffffff",
    elevated: "#e9efec",
    foreground: "#202723",
    mutedForeground: "#66736c",
    border: "#d7dfdb",
    fontFamily: "Inter, system-ui, sans-serif",
    radius: "6px",
  },
}
```

The Host Adapter maps stable Surface tokens to the tested DSH semantic tokens only while that Surface is active. When official Sidebar brand slots exist, `identity` temporarily replaces their mark and name. Cleanup is ownership-aware, so unloading the Surface does not overwrite a newer community plugin change.

## Optional Agent Collaboration

`dsh-ag-ui` is optional. Without it, mounting, routing, layouts, and branding continue to work and `capabilities.agent.status` reports `unavailable`.

When available, an application may register browser-owned Tools:

```tsx
useEffect(
  () =>
    agent.register({
      scopeKey: "document:current",
      label: "Current document",
      tools: [
        {
          name: "document_read",
          description: "Read the current document state.",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          execute: () => JSON.stringify(readCurrentDocument()),
        },
      ],
    }),
  [agent],
);
```

Tools exist only while the Surface and one native DSH Session are active. The bridge uses a loopback/live-pair trust fence, Web Locks for tab leadership, an unguessable capability token, and a Host TTL. Application authorization still belongs to the application backend.

See the installable neutral example in [`examples/ag-ui-tools`](examples/ag-ui-tools).

## Next.js

Next.js support means Client Surface support. Reusable Client Components, providers, Hooks, and browser state can run in DSH. Server Components, Server Actions, middleware, and the Next server remain in the original Next deployment.

The current DSH cohort provides React `18.3.1`. A Next application using React 19-only runtime features requires a compatible future DSH cohort even if its source compiles successfully.

See [Next.js Client integration](docs/next-client.md).

## Runtime Interface

`ctx.reactSurfaces` deliberately stays small:

- `register(definition)` binds an application to its plugin lifecycle.
- `open(id, location?)`, `close()`, and `navigate(location)` control visibility and opaque application location.
- `setLayout(id, layout)` selects one declared semantic layout.
- `getSnapshot()` and `subscribe()` expose observable state.
- `inspect()` returns local diagnostics without application routes, Tool inputs, or business data.
- `version` and monotonic `features` support capability detection.

## Documentation

- [Application integration](docs/application-integration.md)
- [Layouts and branding](docs/layouts-and-branding.md)
- [Next.js Client integration](docs/next-client.md)
- [Optional dsh-ag-ui integration](docs/ag-ui.md)
- [Architecture](docs/architecture.md)
- [Security model](SECURITY.md)

## Development

Requirements:

- Bun `1.4.0` or newer
- Node.js `22.19.0` or newer
- DeepSeek Harness `0.1.1-rc.2`
- `pnpm` on `PATH`, used internally by `dsh plugin`

Run the full local quality gate:

```powershell
bun install
bun run check
```

Run the packaged real-DSH browser lane separately:

```powershell
bun run test:e2e
$env:DSH_AG_UI_DIR = "D:\Projects\Frontend\dsh-ag-ui"
bun run test:e2e
```

The first command verifies graceful operation without `dsh-ag-ui`; the second also packs and installs the explicitly selected AG-UI source checkout.

See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.
