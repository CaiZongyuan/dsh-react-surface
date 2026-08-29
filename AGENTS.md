# DSH React Surface Development Guide

## Scope

- Use Bun for dependency installation, scripts, builds, and tests.
- Keep the runtime product-neutral. Business applications belong in adapters or examples.
- Pin compatibility work to DSH `0.1.1-rc.2` until a deliberate upgrade changes the baseline.

## Architecture

- `packages/runtime/` owns the DSH Host and Client plugin faces.
- `examples/` contains independent DSH plugins that consume the runtime through its public interface.
- React applications register through `ctx.reactSurfaces`; they must not call DSH slot primitives directly.
- Client bundles must use the DSH lazy-CJS wrapper and must externalize the React runtime supplied by DSH.
- Surface application state stays mounted while another surface or the DSH workspace is visible.

## Quality

- Run `bun run check` before considering a change complete.
- Keep registry behavior covered by Bun tests.
- Keep layout behavior in the pure layout engine and DSH DOM ownership in the Host Adapter.
- Keep application CSS inside its ShadowRoot; shell branding uses semantic tokens only.
- Build verification must reject extra chunks, ESM imports, and bundled React copies.
- Host routes require loopback/live-pair trust checks and bounded runtime validation.
- Examples must be product-neutral, independently installable DSH consumers.
- Preserve keyboard access, accessible names, stable layout, and style isolation in every surface host.
