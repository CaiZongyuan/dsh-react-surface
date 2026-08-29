# Optional dsh-ag-ui Integration

`dsh-ag-ui` is an optional community-plugin collaboration. `dsh-react-surface` mounts and lays out applications without it.

## Activation

An application registers one replaceable capability set from the mounted React tree. It becomes active only when:

- that Surface is visible;
- one native DSH Session is current;
- `dsh-ag-ui/browser-tools` is available;
- this browser tab owns the identity leadership and Host lease.

Changing Surface, Session, `scopeKey`, Tool descriptors, browser leadership, or plugin lifecycle releases the prior set.

## Capability State

Use the render-provided state for honest UI:

```tsx
function Application({ capabilities }: ReactSurfaceProps) {
  const { available, status, reason } = capabilities.agent;
  // status: unavailable | idle | connecting | active | contended | error
}
```

Do not make the whole application fail when `available` is false unless Agent operation is the application's only purpose.

## Tool Design

- Read changing application state just in time instead of copying it into every prompt.
- Keep Tool names stable and provider-safe.
- Validate Tool input again inside the application or backend.
- Treat browser state as context, not authorization.
- Derive the native DSH Session on the Host; never accept a model-supplied Session id as authority.
- Keep durable and sensitive actions behind the application backend's normal identity and authorization checks.

See [`examples/ag-ui-tools`](../examples/ag-ui-tools) for a complete neutral counter example with read and write Tools.

Verify both optional states in real DSH:

```powershell
bun run test:e2e
$env:DSH_AG_UI_DIR = "D:\Projects\Frontend\dsh-ag-ui"
bun run test:e2e
```
