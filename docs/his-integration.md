# HIS Integration

The Ankang HIS is the first planned backend-owning consumer. Integrate it only after the generic runtime and basic example pass DSH browser verification.

## Target Shape

```text
Ankang HIS source
├─ standalone adapter -> browser history -> /api
└─ DSH adapter        -> memory history  -> /his-api
                         |
                         -> dsh-react-surface
```

The HIS application stays in its existing repository. Its adapter package depends on `dsh-react-surface` and `dsh-react-surface-build`; the generic runtime must not import HIS code.

## Required HIS Changes

1. Extract a reusable `<HisApp runtime={...} />` from the current `createRoot` entry.
2. Make router history and HTTP base paths runtime inputs.
3. Compile HIS CSS to text that is safe inside a ShadowRoot.
4. Route every Base UI and Sonner portal to `ReactSurfaceProps.portalRoot`.
5. Create a DSH adapter definition such as `ankang.his` and register it through `ctx.reactSurfaces`.
6. Add a fixed Host proxy from `/his-api/*` to the Hono `/api/*` routes.
7. Verify dashboard and patient detail before adding the CopilotKit assistant bundle.

## Adapter Sketch

```tsx
function AnkangHisSurface({
  close,
  location,
  navigate,
  portalRoot,
}: ReactSurfaceProps) {
  const runtime = createHisRuntime({
    apiBasePath: "/his-api",
    initialLocation: location,
    onLocationChange: navigate,
    portalRoot,
  });

  return <HisApp runtime={runtime} onExit={close} />;
}
```

The real implementation should create stable runtime objects outside render or behind lazy initialization; the sketch only shows the data crossing the Interface.

## Acceptance Order

1. Dashboard loading, empty, error, and successful states.
2. Patient navigation with location retention across close/open.
3. Dialog, select, dropdown, tooltip, and toast portals.
4. Desktop and mobile layouts.
5. Encounter workflow and server-side validation.
6. CopilotKit streaming, page context, frontend tools, and continuation.

This project remains a demonstration HIS, not a production medical device. Only fictional patient data may be used during integration and testing.
