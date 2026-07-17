# Change: v0.4.0 Deterministic Release Closeout

## Status: APPROVED FOR IMPLEMENTATION

## Beads

- `autoresearch-mcp-azn` — release-closeout hardening
- `autoresearch-mcp-7qa` — registry publication, currently blocked by npm authentication

## Why

The v0.4.0 implementation and integrity remediation are complete, but the final registry transaction is not fully executable from checked-in contracts. Current tracking still names a working-directory publish command, records only SHA-256, does not provide an exact registry smoke, leaves release-commit authority ambiguous after administrative merges, and contains stale claims that integrity remediation is pending.

Authentication is an external operator boundary. Everything before and after that boundary must be deterministic, fail closed, and reviewable without registry credentials.

## Scope

- Check in one schema-closed release-artifact record containing package name, version, canonical registry, expected publisher, SHA-256, SHA-512, SHA-512 SRI, and bounded registry-read policy.
- Make packed-package CI compare every reconstructed artifact against both approved digests and optionally export the exact verified tarball.
- Add a fail-closed publication command that publishes only the verified `.tgz`, never the working directory, and never automatically repeats an ambiguous mutation.
- Add one registry smoke command that downloads the registry tarball, proves byte identity, clean-installs those verified bytes, audits production dependencies, exercises both bins, and performs an MCP initialize/tools/version handshake.
- Add separate fail-closed deprecation and tag-closeout commands with distinct authorization tokens.
- Bind tag authority to the clean, mirrored Forgejo `main` commit used to reconstruct the matching artifact; tagging remains prohibited until registry smoke passes.
- Document an exact deprecation/no-tag rollback when immutable publication succeeds but registry smoke fails.
- Reconcile README, changelog, project state, both active v0.4.0 OpenSpecs, and Beads with completed integrity work and the remaining authentication boundary.

## Non-Goals

- Do not publish, deprecate, or tag while npm authentication is unavailable.
- Do not add a deployed service; npm remains the only deployment target.
- Do not implement roadmap execution features such as `run_ratchet`, Docker sandboxing, or bounded autonomous episodes.
- Credentials may exist only in an approved external user-level npm credential store outside the repository/worktree. Do not place them in repository files, command arguments, artifacts, logs, CI, or review tooling.

## Acceptance Criteria

- The approved artifact record is schema-validated and exactly matches a deterministic double-pack from the current release tree.
- Package smoke fails on either digest mismatch and can export only the already-verified tarball to an operator-selected directory.
- The publish mutation refreshes live Forgejo/GitHub refs, captures `RELEASE_SHA`, and refuses unless the checkout is clean, local `HEAD`, both live `main` refs, and the captured SHA agree; both live tags are absent; the confirmation binds package, version, registry, publisher, release SHA, and SHA-256; npm identity equals the checked-in publisher; and authoritative registry state is conclusively absent. A `present-exact` version bypasses mutation and enters registry smoke/resume instead.
- Publication invokes `npm publish <absolute-verified-tarball> --access public`; publishing `.` or the working tree is impossible.
- After every single publish attempt, including nonzero exit or timeout, bounded read-only reconciliation checks fresh registry/cache directories. Exact bytes continue to smoke; absent or ambiguous exhaustion stops for operator reconciliation; publish is never retried automatically.
- A pre-existing exact version enters resume/smoke only after downloaded SHA-256, SHA-512, and SRI match. Different or unverifiable bytes hard-stop without republish, tag, or automatic deprecation.
- Registry smoke requires registry version `0.4.0`, downloads `autoresearch-mcp@0.4.0` with `npm pack`, verifies both hex digests and registry SRI, installs that verified tarball in a fresh external directory, runs `npm audit --omit=dev`, exercises both bins, and verifies MCP initialize, exact 12-tool listing, server version, and catalog total.
- Registry-smoke behavior is also proven before publication against the locally verified tarball without weakening the default registry path.
- Successful registry smoke writes a closed-schema, read-only external evidence file carrying the original captured release SHA and artifact identity. Tag closeout requires that evidence and a separate confirmation bound to its SHA-256; it never silently recaptures a later main SHA.
- Tag closeout classifies each remote annotated/peeled tag as absent, present-exact, present-conflict, or ambiguous. It resumes exact tags, creates only absent tags, never deletes/recreates/force-updates, and requires Forgejo exact verification before any GitHub push.
- Deprecation has a separate confirmation and expected-publisher check. It pins exact package/version/registry/message, verifies the resulting `deprecated` field, defines a separately authorized exact clear command that verifies the field is absent or exactly empty, and prohibits `npm unpublish`.
- Transient/ambiguous smoke exhaustion never triggers automatic deprecation.
- Public and OpenSpec status consistently state that integrity remediation is complete and only npm authentication/publication/smoke/tag/archive remain.
- Hermetic fake-`npm`/fake-`git` tests prove every mutation/state transition without network access or registry mutation, including dirty/ref/digest/account/registry failures, E404 discrimination, remote advancement, timeout-after-acceptance, pre-existing exact/conflicting bytes, bounded fresh-cache retries, tarball-only publish-once, separately authorized deprecation/tagging, and local-mode non-bypass.
- Full tests, typecheck, lint, build, audits, deterministic package smoke, release-contract tests, YAML parsing, and diff checks pass.

## Deployment and Rollback

There is no runtime service deployment. Delivery is the immutable npm publication followed by clean registry smoke and release tagging.

Before publication, rollback is branch/PR abandonment. If npm accepts exact `0.4.0` bytes but a deterministic non-transient registry smoke fails, an operator may separately authorize the checked-in exact deprecation command. Create no `v0.4.0` tag, do not archive the active release OpenSpecs, and open a new-version correction. `npm unpublish` is prohibited. Clearing a mistaken deprecation requires another separate authorization and the checked-in exact empty-message command.
