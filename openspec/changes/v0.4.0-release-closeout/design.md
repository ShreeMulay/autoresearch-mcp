# Design: v0.4.0 Deterministic Release Closeout

## Authority Model

`ci/release-artifact.json` is the merged-main expected-identity record. It is schema-closed, excluded from the package, and contains stable package/version/registry/publisher identity, complete SHA-256/SHA-512 digests, SHA-512 SRI, and bounded registry-read policy. It is not self-authenticating: protected Woodpecker CI for the exact merged SHA must reconstruct the tarball, match all identity fields, and pass package contracts.

The release commit is resolved at execution time. The workflow queries live Forgejo/GitHub refs immediately before mutation, captures `RELEASE_SHA`, and requires a clean checkout where `HEAD` and both live `main` refs equal it. It also proves both live `v0.4.0` tags are absent. The verified tarball must match the checked-in identity. The captured commit becomes the only possible tag target after registry smoke; any later main advancement prevents automatic tag closeout and requires reconciliation against the captured SHA.

## Artifact Reconstruction

`ci/package-smoke.sh` remains the canonical reconstruction and local package proof under Bun 1.3.10, Node 22.22.1, and npm 10.9.4. It double-packs outside the checkout, proves byte identity, validates the exact manifest and dependency floors, then runs installed-package contracts.

The script additionally validates every closed-schema field in `ci/release-artifact.json`. An optional artifact-output directory receives a copy only after every package-smoke assertion succeeds. Failed smoke leaves no release candidate.

## Publication Boundary

`bun run release:control -- publish`, implemented by `ci/release-control.ts`, is intentionally narrow and fail closed:

1. Load the closed identity record and pin `https://registry.npmjs.org/` on every npm operation.
2. Refresh/query live refs, capture `RELEASE_SHA`, and validate clean/ref-equal/tag-absent authority.
3. Validate an exact confirmation binding package, version, registry, expected publisher, release SHA, and artifact SHA-256.
4. Validate `npm whoami` equals the expected publisher without printing credentials or config.
5. Classify registry state from structured npm error codes and downloaded bytes: `absent`, `present-exact`, `present-conflict`, or `ambiguous`.
6. `present-exact` never republishes and bypasses the publish mutation to enter resume/smoke. `present-conflict` or `ambiguous` hard-stops. Only authoritative `absent` permits a new publish mutation.
7. Reconstruct and verify the tarball through package smoke, then immediately repeat live-ref/tag/clean/digest checks.
8. Invoke exactly once: `npm publish <absolute-tgz> --access public --registry=https://registry.npmjs.org/`.
9. Regardless of publish exit/timeout, run bounded read-only reconciliation. Exact bytes continue to registry smoke. `present-conflict` hard-stops without retry, tag, or automatic deprecation. Absent or ambiguous exhaustion stops for operator reconciliation and never republishes automatically.

The controller never accepts package/version/registry/publisher overrides and never publishes a directory. It does not dump npm configuration, log tokens/OTP, or pass credentials in arguments. Authentication may come only from approved external user-level npm config outside the repository/worktree.

## Registry State and Retry Model

Read-only registry checks use the manifest's fixed attempt count and backoff. Each attempt uses a new external HOME, npm userconfig, cache, pack destination, and install directory. Only exact E404 from the canonical registry after expected-publisher authentication counts as absent. E401/E403/ETARGET, DNS, timeout, rate limit, 5xx, malformed metadata, or unverifiable downloads are ambiguous/hard failure according to state and never authorize mutation.

After a publish attempt, exact downloaded bytes establish acceptance even when the publish process timed out. Persistent authoritative absence does not trigger an automatic retry; the operator must reconcile and initiate a new separately confirmed run. Existing different bytes are immutable conflict.

## Registry Smoke

`bun run release:control -- smoke`, implemented by `ci/release-control.ts`, defaults to the immutable registry spec `autoresearch-mcp@0.4.0`. It downloads with `npm pack --registry=https://registry.npmjs.org/`, compares SHA-256/SHA-512 and registry `dist.integrity`, then installs only the verified downloaded tarball into a separate fresh directory. It runs production audit pinned to the canonical registry, both public bins, installer dry-run, and an MCP protocol handshake with exact version/tool/catalog assertions.

Package CI exercises the same installed-artifact behavior against the verified local tarball through an explicit local-artifact mode. The local mode cannot change expected package/version/registry/digests, cannot authorize publish/deprecate/tag, and runs with sanitized environment, isolated HOME/userconfig/cache, and synthetic PHI-free MCP requests.

## Tag and Archive Sequence

Successful registry smoke writes a closed-schema evidence file to an operator-selected external directory, chmods it read-only, and records package/version/registry/publisher, artifact digests/SRI, the original captured `RELEASE_SHA`, and smoke completion time. Tag closeout requires the absolute evidence path and a separate confirmation bound to the evidence file's SHA-256. It validates the file and registry again; it never recaptures or substitutes a later main SHA.

`bun run release:control -- tag`, implemented by `ci/release-control.ts`, classifies Forgejo and GitHub independently using both `refs/tags/v0.4.0` and its peeled `^{}` ref:

- `absent`: no tag object or peeled ref; eligible for creation/push.
- `present-exact`: an annotated tag exists and peels exactly to evidence `RELEASE_SHA`; verified/resumable.
- `present-conflict`: a lightweight tag, mismatched peeled target, or inconsistent object/peeled pair; hard stop.
- `ambiguous`: live query failure or unparsable response; hard stop.

The command requires clean `HEAD == evidence RELEASE_SHA` and both live main refs still equal it. It creates an annotated local tag only when needed, never deletes/recreates/force-updates any tag, pushes Forgejo only when Forgejo is absent, and verifies Forgejo present-exact before considering GitHub. If Forgejo is exact and GitHub absent, it pushes then verifies GitHub. Both exact is a successful resume. GitHub exact while Forgejo is absent/conflicting, or either remote conflict/ambiguity, hard-stops. Archive/Beads closure occurs only after both remotes are present-exact.

## Deprecation Contract

Deprecation is never automatic. A separate confirmation bound to publisher/package/version/registry/message is required for:

`npm deprecate autoresearch-mcp@0.4.0 "DEPRECATED: v0.4.0 failed post-publication integrity verification. Do not install. Await a corrected release." --registry=https://registry.npmjs.org/`

The command verifies expected publisher first and then verifies the exact registry `deprecated` field. Clearing a mistaken deprecation is separately authorized and uses:

`npm deprecate autoresearch-mcp@0.4.0 "" --registry=https://registry.npmjs.org/`

After clearing, bounded canonical-registry reads must prove the exact version's `deprecated` field is absent or exactly empty. Ambiguous or nonempty results fail closed. `npm unpublish` is prohibited.

## Failure Semantics

- Pre-publication failure: no registry mutation, no tag, no archive.
- Registry version already exists with exact bytes: no republish; resume registry smoke. Different or unverifiable bytes: hard stop.
- Publish exit/timeout: reconcile read-only; never automatically republish.
- Transient/ambiguous smoke exhaustion: stop without deprecation or tag.
- Deterministic post-publication failure of exact bytes: optionally run separately authorized exact deprecation; create no tag, keep release tracking open, and move correction to a new version.
- Secrets remain only in approved external user-level npm config; smoke subprocesses receive sanitized environments and never inherit auth configuration.
- Authentication failure: preserve verified source/artifact evidence and keep `autoresearch-mcp-7qa` blocked.
