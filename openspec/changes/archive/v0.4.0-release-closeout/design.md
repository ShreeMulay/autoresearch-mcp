# Design: Lean v0.4.0 Release

## Protected source

Release from a clean revision merged through the protected Forgejo pull-request path after the terminal `ci` context passes for the exact head. The terminal context continues to depend on Bun checks, Node 22 and 24 installer checks, and the canonical package smoke.

GitHub CI is a non-authoritative mirror. It retains proportionate quality and standalone installer validation but does not repeat package artifact smoke or preserve immutable smoke logs.

## Package and publication

`bun run test:package -- --artifact-output /absolute/dir` creates the candidate outside the checkout only after package safety checks pass. No candidate tarball or digest is committed.

With npm authentication supplied only through external user-level configuration, `bun run release:control -- publish /absolute/package.tgz` publishes that explicit tarball and never the repository directory. `bun run release:control -- smoke /absolute/package.tgz` validates the released package in a fresh consumer environment.

npm versions are immutable. A pre-existing conflict, an ambiguous publish outcome, or any uncertainty about which bytes were accepted is a hard stop for operator reconciliation. The controller does not automatically retry publication, deprecate a version, clear deprecation, unpublish, or create tags.

## Tagging

Only after registry smoke succeeds, create the ordinary annotated `v0.4.0` tag on the clean release revision. Push and verify Forgejo first, then mirror the same tag to GitHub. No evidence ledger or custom tag-object identity protocol is required.

## Execution boundary

This archived design records implementation only. npm publication, registry smoke, and tag pushes have not occurred and remain tracked by Bead `autoresearch-mcp-7qa`.
