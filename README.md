# dsh-react-surface

`dsh-react-surface` is a DSH-native runtime for mounting independently packaged React applications as full-frame surfaces. Applications keep their own state while hidden, share the React runtime provided by DSH, and render inside isolated ShadowRoots.

This repository currently targets DeepSeek Harness `0.1.1-rc.2`. It is an experimental integration package, not a stable public release.

## Architecture

```text
DSH Web
├─ dsh-react-surface
│  ├─ shell.overlay -> ReactSurfaceHost
│  ├─ sidebar.footer.action -> application launchers
│  └─ ctx.reactSurfaces -> register/open/close/navigate
└─ application adapter plugins
   ├─ example.basic
   ├─ ankang.his
   └─ other React applications
```

The runtime does not load arbitrary Vite HTML output. Each application is compiled as a DSH Client plugin and registers one typed React surface.

The repository has three deliberately separate roles:

- `packages/runtime` is the DSH plugin and browser runtime.
- `packages/build` is the reusable Bun build adapter that emits DSH lazy-CJS artifacts.
- `examples/basic-surface` is an independent application plugin and the first consumer of both packages.

## Requirements

- Bun `1.4.0` or newer
- Node.js `22.19.0` or newer
- DeepSeek Harness `0.1.1-rc.2`
- `pnpm` on `PATH` because `dsh plugin` delegates profile package management to pnpm

## Develop

```powershell
bun install
bun run check
```

`bun run check` typechecks the workspace, runs the registry tests, builds both DSH packages, verifies the lazy-CJS artifacts, and checks formatting.

## Install The Local PoC

Build the packages first:

```powershell
bun run build
```

Install the runtime and the independent example into the DSH Web profile:

```powershell
dsh.cmd plugin --profile web add ./packages/runtime
dsh.cmd plugin --profile web add ./examples/basic-surface
dsh.cmd web
```

Restart DSH after changing the installed package graph. Rebuild and refresh the browser after changing Client code.

## Register An Application

An application adapter has a no-op Host entry, a DSH client manifest, and a Client entry that registers its React root:

```tsx
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import {
  defineReactSurface,
  type ReactSurfaceProps,
} from "dsh-react-surface/client";

function Application({
  close,
  location,
  navigate,
  portalRoot,
}: ReactSurfaceProps) {
  return <YourApp />;
}

const definition = defineReactSurface({
  id: "example.application",
  title: "Example Application",
  component: Application,
  styles: "/* application CSS */",
});

export const inject = ["reactSurfaces"];

export function apply(ctx: ClientContext) {
  ctx.effect(() => ctx.reactSurfaces.register(definition));
}
```

The adapter package must declare both `dsh.bundle.patch` and `dsh.client`. It must also list `dsh-react-surface/client` in `dsh.client.external`, so the DSH module graph supplies one shared runtime implementation.

Build an adapter package with:

```powershell
bunx dsh-react-surface-build .
```

The package convention is `src/index.ts` for the Host entry and `src/client/index.tsx` for the Client entry. The builder emits `lib/index.js` and one wrapped `lib/client.js`; an application's own TypeScript configuration remains responsible for declaration files.

## Runtime Interface

`ctx.reactSurfaces` deliberately exposes a small interface:

- `register(definition)` ties an application to its plugin lifetime.
- `open(id, location?)` displays an application.
- `close()` reveals the native DSH workspace.
- `navigate(location)` updates the active application's retained location.
- `getSnapshot()` and `subscribe()` support React and non-React consumers.

The runtime owns DSH slot registration, ShadowRoot creation, application visibility, error isolation, and shared React usage. Application adapters own routing, providers, business state, and backend integration.

See [Architecture](docs/architecture.md) for lifecycle and module details and [HIS Integration](docs/his-integration.md) for the next implementation stage.
