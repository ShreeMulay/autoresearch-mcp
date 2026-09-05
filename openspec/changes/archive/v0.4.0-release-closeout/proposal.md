# Change: Lean v0.4.0 Release Cutover

## Status

Implemented and archived. This record covers release tooling, CI, documentation, and removal of obsolete deterministic-release ceremony. It does not record an npm publication, registry smoke, or tag.

## Why

The fixed-digest release process duplicated package checks and required confirmations, evidence files, tag-object identity checks, and recovery gates disproportionate to this package. The release should retain the actual safety boundaries while using a short, operator-readable path.

## Change

- Keep protected Forgejo pull-request CI authoritative, including Bun validation, Node 22/24 installer coverage, package smoke, and the terminal `ci` context.
- Keep GitHub as a non-authoritative mirror with quality checks and Node 22/24 installer coverage, without duplicate packed-artifact smoke or log archival.
- Build and test an explicit tarball, publish only that absolute `.tgz`, smoke it, and then create a normal annotated tag.
- Keep npm credentials external, refuse directory publication, and stop on an existing conflicting or ambiguous immutable npm version.
- Remove fixed tarball digests, custom release confirmations, evidence files, automatic deprecation/clear operations, and custom tag-object orchestration.
- Archive this implementation contract so release execution needs no active OpenSpec.

## Acceptance

- No tarball or fixed digest is committed as release authority.
- Package manifest, executable, install, audit, and MCP smoke protections remain enforced by the shared package test.
- Publication and smoke accept only an explicit absolute tarball path.
- Obsolete release-control callers and ceremony-specific contracts are removed.
- Forgejo remains the protected exact-head gate; GitHub remains mirror validation only.
- Current documentation describes one lean path and does not claim publication.

Actual npm publication, registry smoke, and tagging remain unperformed and are owned only by Bead `autoresearch-mcp-7qa`.
