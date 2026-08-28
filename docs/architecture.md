# Architecture

## Objective

`dsh-react-surface` lets independently packaged React applications participate in the DSH Client plugin tree without importing DSH UI implementation details. It is a runtime and build interface, not an HTML, iframe, or arbitrary Vite-dist loader.

## Modules

```text
application plugin
  -> defineReactSurface(...)
  -> ctx.reactSurfaces.register(...)

dsh-react-surface client plugin
  -> ctx.reactSurfaces
  -> shell.overlay
  -> sidebar.footer.action
  -> one ShadowRoot per application

DSH Web
  -> shared React 18.3.1
  -> Client Cordis lifecycle
  -> native workspace kept mounted underneath
```

The runtime has one public Interface, `ReactSurfaceRegistry`. Applications do not call `ctx.slots` and do not manipulate the DSH frame.

## Registration Lifecycle

1. DSH loads the runtime client bundle and provides `ctx.reactSurfaces`.
2. An application plugin waits on the `reactSurfaces` Cordis service.
3. The application calls `register(definition)` inside its plugin effect.
4. The runtime renders the application in its own ShadowRoot and adds a sidebar launcher.
5. Unloading the application plugin calls the registration disposer and removes only that application.
6. Unloading the runtime removes its slot entries and service through the owning Cordis effect.

Opening or closing a surface changes visibility, focus availability, and the inert state of the native DSH frame. It does not unmount either the React application or the DSH workspace. Each application retains its last location independently.

## Client Module Graph

Every application bundle declares:

```jsonc
{
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["dsh-react-surface"],
      "external": ["dsh-react-surface/client"],
    },
  },
}
```

The build adapter keeps React, ReactDOM, Cordis, the DSH slot/primitives modules, and declared DSH externals out of application bundles. DSH supplies those modules from its browser module table. The build fails when an application emits dynamic chunks or assets instead of one self-contained Client entry. Artifact verification also rejects ESM imports, unsupported `require()` calls, and bundled React copies.

## Style And Portal Isolation

Each application receives a dedicated open ShadowRoot. Its `styles` text is installed inside that root, and the application receives the same root as `portalRoot`. UI libraries with portals must direct dialogs, menus, tooltips, toasts, and other floating layers to this target.

The runtime applies only minimal host styles and does not project application tokens onto `html`, `body`, or the DSH theme. Applications remain responsible for ensuring their CSS is valid inside a ShadowRoot.

## Routing

The registry stores an opaque application-owned `location` string. It neither parses paths nor owns a router. A TanStack Router adapter should use memory history and translate `ReactSurfaceProps.location` into its initial or current route. Browser history remains available to an application's standalone adapter.

## Host Responsibilities

The current Host entry is intentionally empty because the example has no backend. A reverse proxy will be added when the first backend-owning application defines real requirements. That future module must use a fixed, validated upstream and a namespaced path; it must not become a general open proxy.

## Compatibility

The current package pins its DSH development dependencies to `0.1.1-rc.2` and relies on the React `18.3.1` platform modules shipped by that release. DSH Client package, slot, or build-format upgrades require a deliberate compatibility change and a real browser test.
