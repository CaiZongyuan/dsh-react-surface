# Layouts And Branding

## Semantic Layouts

Surface layout is declared in DSH terms, not selectors:

| Preset         | Preserved DSH regions              | Resizable value    |
| -------------- | ---------------------------------- | ------------------ |
| `full-frame`   | None                               | None               |
| `center`       | Sidebar                            | None               |
| `workspace`    | Sidebar, Conversation, Details     | Conversation width |
| `right-panel`  | Sidebar, native workspace, Details | Surface width      |
| `bottom-panel` | Sidebar, native workspace, Details | Surface height     |

```ts
layout: {
  default: "workspace",
  supported: ["full-frame", "center", "workspace", "right-panel"],
  fallback: "full-frame",
  minSurfaceWidth: 520,
  conversation: { min: 340, initial: 420, max: 560 },
  rightPanel: { min: 320, initial: 420, max: 640 },
  bottomPanel: { min: 240, initial: 320, max: 520 },
  resizable: true,
  persist: true,
}
```

Panel dimensions and the selected layout are stored under a versioned localStorage key. Invalid values are sanitized, storage failures stay in memory, and `ctx.reactSurfaces.resetPreferences(id?)` is the escape hatch.

## Responsive Behavior

If a split cannot satisfy both application and native pane minimums, it falls back to `full-frame` or `center`. The requested and resolved layouts remain visible in `inspect()` diagnostics.

Every ShadowRoot establishes named inline-size containers. Application CSS should use container queries because a Surface width can change without the browser viewport changing:

```css
@container dsh-react-surface-content (max-width: 560px) {
  .application-toolbar {
    grid-template-columns: 1fr;
  }
}
```

## Brand Tokens

The stable token contract is:

```text
--dsh-surface-background
--dsh-surface-surface
--dsh-surface-elevated
--dsh-surface-foreground
--dsh-surface-muted-foreground
--dsh-surface-border
--dsh-surface-accent
--dsh-surface-accent-foreground
--dsh-surface-font-family
--dsh-surface-radius
```

Use `branding.shell: "preserve"` for an independently branded application. Use `"surface"` when the visible DSH Sidebar, conversation, controls, and the Surface should read as one product.

An active Surface can also coordinate the official Sidebar identity:

```ts
branding: {
  shell: "surface",
  identity: { name: "Acme Dashboard", mark: "AD" },
  tokens: { /* semantic brand values */ },
}
```

The identity replacement is limited to official `sidebar.brand.mark` and `sidebar.brand.name` slots. If the current DSH cohort does not expose them, the Runtime preserves the original DSH identity.

The Runtime maps only semantic tokens verified for the supported DSH cohort. It does not accept DSH selectors or arbitrary global CSS through the public Interface.
