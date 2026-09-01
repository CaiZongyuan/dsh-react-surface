# Architecture

## Product Boundary

`dsh-react-surface` is a product-neutral runtime and build interface for trusted, installed React applications. It is not another DSH workbench, a remote page loader, a business framework, or a replacement conversation UI.

The runtime is intentionally a deep module: application Adapters learn one small Interface while layout compatibility, DOM ownership, lifecycle cleanup, style extraction, preference migration, and optional Agent transport stay behind it.

## Modules

```text
application Adapter
  -> defineReactSurface(...)
  -> ctx.reactSurfaces.register(...)

dsh-react-surface Client
  -> ReactSurfaceRegistry
  -> unified launcher
  -> ReactSurfaceHost
  -> DSH Host Adapter
  -> one ShadowRoot per mounted Surface

dsh-react-surface Host
  -> optional /react-surface-agent bridge
  -> optional dsh-ag-ui/browser-tools
  -> exact native DSH Agent scope

dsh-react-surface-build
  -> host ESM artifact
  -> one DSH lazy-CJS client artifact
  -> extracted CSS and small assets embedded by Surface id
```

## Public Interface

`ReactSurfaceRegistry` is the external seam. It owns:

- registration and plugin-lifetime disposal;
- one active Surface and retained opaque locations;
- user-selected semantic layout;
- lazy/eager mounting and hidden retention;
- optional Agent registrations whose functions never cross the Host seam;
- runtime metadata, capability detection, and local diagnostics.

Application Adapters do not receive the Host Adapter, preference store, effect ledger, DSH elements, selectors, or transport details.

## Shell Coordination

The Client mounts through official `shell.overlay` and `sidebar.footer.action` Slots. Split layouts require geometry from the DSH frame. The Host Adapter resolves official semantic pane attributes first, then the tested `0.1.2-alpha.3` frame structure as a centralized fallback.

The pure layout engine receives only geometry, semantic layout, constraints, and retained UI sizes. It produces Surface bounds, native pane sizing, resize metadata, and an explicit fallback reason. Unknown or unusable geometry falls back to full-frame rather than mutating an unrecognized shell.

One activation-scoped effect ledger owns:

- DSH attributes and inline semantic token overrides;
- native pane width, height, borders, `inert`, and `aria-hidden`;
- ResizeObserver and MutationObserver instances;
- preference subscriptions and scheduled animation frames.

Cleanup runs newest-first, is idempotent, and continues after one cleanup failure. DOM values are restored only while the Runtime still owns the value, so a later community plugin update is not overwritten.

## Layouts

- `full-frame` covers and disables the DSH frame.
- `center` preserves the DSH Sidebar and uses the remaining frame.
- `workspace` places the application between the Sidebar and native conversation/details panes.
- `right-panel` preserves the native DSH workspace and places the application before Details.
- `bottom-panel` places the application below the native workspace.

Only one React Surface is active. Flexible layout means coordination with semantic DSH regions, not a multi-application canvas.

## Style And Brand Isolation

Each mounted application has one open ShadowRoot. The build adapter extracts imported CSS and CSS Modules, structurally inlines local CSS assets through PostCSS, and embeds the result under `dsh.reactSurface.id`. At registration, the Runtime combines that CSS with explicit `definition.styles` inside the matching ShadowRoot.

Stable `--dsh-surface-*` variables are always available. `branding.shell: "surface"` temporarily maps the active Surface values onto tested DSH semantic aliases on the frame; `"preserve"` keeps the product brand inside the ShadowRoot. Optional product identity uses only official `sidebar.brand.mark` and `sidebar.brand.name` slots and stays unchanged when those slots are unavailable.

## Optional Agent Collaboration

The Host Agent bridge exists only when `webServer`, `agents`, and `dsh-ag-ui`'s `browserTools` service are available. The Client probes capabilities and reports `unavailable` without affecting the Surface when that service is absent.

When active:

1. The Client combines the active Surface, current native Session, and current `scopeKey`.
2. Web Locks elect one browser-tab leader for that identity.
3. The Host verifies loopback or live-pair trust and resolves an already-live native Agent.
4. The Host issues an unguessable capability token and a 45-second renewable lease.
5. Tool invocations are long-polled to the browser and executed against the latest registration.
6. Closing the Surface, changing Session/scope, unloading either plugin, losing leadership, or missing the TTL releases Tools.

DSH pairing authorizes entry to this bridge, not application data. Every application backend remains responsible for user identity, resource authorization, validation, and durable effects.

## Compatibility

The current tested cohort is DSH `0.1.2-alpha.3` with React `18.3.1`. Client plugins use Cordis for their context type and the DSH UI Renderer for Slot ownership; the removed Client Runtime aggregate is not part of the cohort. Runtime `version`, `interfaceVersion`, and monotonic `features` let Adapters detect capability rather than guess from package versions.

Any future DSH cohort change requires unit tests, packaged artifact checks, and a real browser mount before its compatibility claim is updated.
