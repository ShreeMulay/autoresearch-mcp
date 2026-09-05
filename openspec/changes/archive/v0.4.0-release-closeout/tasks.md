# Tasks: Lean v0.4.0 Release Cutover

## Implementation

- [x] Remove committed tarball digest authority and ceremony-specific release state.
- [x] Retain package safety checks while accepting an external artifact-output directory.
- [x] Reduce release control to explicit absolute-tarball publish and smoke commands.
- [x] Remove obsolete confirmation, evidence, deprecation/clear, and tag-control callers.
- [x] Keep Forgejo PR-only jobs `bun`, `node22`, `node24`, `package_smoke`, and terminal `ci` with pinned checkout actions and container images.
- [x] Remove duplicate GitHub package smoke and immutable log upload while retaining quality and Node 22/24 installer coverage.
- [x] Rewrite current release documentation and project state for the lean path.
- [x] Update strict workflow/config tests and archive this implementation contract.

## Release execution (not performed by this change)

- [ ] Publish `autoresearch-mcp@0.4.0` with external npm authentication.
- [ ] Run registry smoke against the published package.
- [ ] Create and push `v0.4.0` Forgejo-first, then mirror it to GitHub.

These unchecked operations are owned only by Bead `autoresearch-mcp-7qa`. Their unchecked state is intentional and is not an incomplete OpenSpec implementation item.
