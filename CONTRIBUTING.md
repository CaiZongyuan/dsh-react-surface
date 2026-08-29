# Contributing

## Scope

Changes should improve the product-neutral React-to-DSH integration. Application-specific data models, authorization, prompts, workflows, and complete workbench features belong in application Adapters or separate plugins.

The public Interface must stay smaller than the behavior it hides. Adapters declare semantic intent; they do not receive DSH selectors or mutable Host elements.

## Development

```powershell
bun install
bun run check
```

Use Bun for dependency installation, scripts, builds, and tests. Keep DSH `0.1.1-rc.2` as the compatibility baseline until a deliberate cohort change includes a real browser mount.

## Change Expectations

- Preserve `register/open/close/navigate/agent.register` compatibility.
- Add capabilities through monotonic `features` and optional definition fields.
- Test behavior through the Runtime, layout-engine, build, or Host bridge Interface.
- Add a packaged consumer test for build-format, CSS, asset, or module-graph changes.
- Keep React and ReactDOM external to every Client bundle.
- Restore all DSH DOM, styles, attributes, listeners, observers, and leases on unload.
- Use fictional, product-neutral examples only.
- Update English and Chinese entry documentation for user-facing changes.

## Pull Requests

Include:

- the user problem and intended Surface behavior;
- DSH cohort and browser used for verification;
- tests added or changed;
- screenshots for layout or launcher changes at desktop and narrow widths;
- compatibility and cleanup risks.
