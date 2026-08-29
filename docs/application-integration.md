# Application Integration

## Generated Adapter

From the cloned `dsh-react-surface` repository:

```powershell
bun packages/build/src/cli.ts init D:\Projects\my-react-app --framework vite
```

The generator writes only `integrations/dsh` and refuses to overwrite existing files. Preview the file list first with `--dry-run`.

Useful options:

```text
--framework vite|next
--entry src/App.tsx
--id acme.dashboard
--title "Acme Dashboard"
--output integrations/dsh
--dry-run
```

The generated package declares:

- a no-op Host entry;
- a DSH Client entry;
- `dsh.reactSurface.id` for extracted styles;
- `dsh-react-surface/client` as a DSH browser external;
- source-relative dependencies on the cloned Runtime and Build packages.

## Reuse Existing Providers

Import the same provider composition used by the standalone application, but replace browser-global concerns at the Adapter seam:

```tsx
export function SurfaceRoot({ portalRoot }: ReactSurfaceProps) {
  return (
    <ApplicationProviders portalRoot={portalRoot}>
      <Application />
    </ApplicationProviders>
  );
}
```

Dialogs, menus, tooltips, toasts, and other portals must target `portalRoot`; a portal attached to `document.body` escapes ShadowRoot styling.

## Routing

The Runtime stores an opaque `location` string and does not select a Router. Use memory history inside DSH and translate Router changes through `navigate(location)`. Keep browser history in the standalone application Adapter.

This works with React Router, TanStack Router, a small application-owned reducer, or a Next Client navigation wrapper without adding Router dependencies to the Runtime.

## CSS And Assets

CSS imported from the DSH Client graph is extracted and attached to the matching ShadowRoot. CSS Modules remain usable. Local CSS URLs for images and fonts are processed by PostCSS and inlined; common assets imported from JavaScript are emitted as data URLs.

The package manifest must match the registered definition:

```json
{
  "dsh": {
    "reactSurface": { "id": "acme.dashboard" }
  }
}
```

Dynamic JavaScript chunks are deliberately rejected in the current source-installed release. Keep the Adapter graph self-contained; a future lazy-chunk protocol must include package-owned routing and packaged-consumer tests before it is enabled.

## Lifecycle

```ts
lifecycle: {
  mount: "lazy",
  retention: "keep-alive",
}
```

- `lazy` mounts on first open; `eager` mounts at registration.
- `keep-alive` retains React state while hidden.
- `unmount-on-close` releases the React tree and browser-owned Agent registration.

Use `unmount-on-close` for memory-heavy applications whose state already lives in a Query cache, URL, or backend.
