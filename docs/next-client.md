# Next.js Client Integration

## Supported Model

The DSH Adapter is a separate browser build that reuses client-safe modules from an existing Next.js repository. The original Next deployment still owns Server Components, Server Actions, route handlers, middleware, image optimization, and SSR.

Good candidates for direct reuse:

- components marked `"use client"`;
- plain React components and Hooks;
- Zustand and client-side Query providers;
- application-owned API clients;
- design-system components whose portals can target `portalRoot`.

Modules that need an Adapter:

- `next/navigation` and App Router state;
- `next/image`;
- server-only environment variables;
- Server Components and Server Actions;
- code that assumes `document.body` owns every portal or global style.

## Generate

```powershell
bun packages/build/src/cli.ts init D:\Projects\my-next-app --framework next
```

The generated `surface-root.tsx` starts with `"use client"`. Import a client-safe product root there and provide memory navigation for DSH. Do not import `app/page.tsx` unless it is itself a pure Client Component without server dependencies.

## React Compatibility

The current tested DSH cohort supplies React `18.3.1` to every Client plugin. React and ReactDOM are externalized so the Adapter never bundles a second copy.

A Next project can use a React 19 toolchain while sharing components that only use React 18-compatible runtime behavior. Components that call React 19-only APIs require a DSH cohort that also supplies React 19. The build succeeding is not proof of runtime compatibility; verify the packaged Adapter in a real DSH browser.
