# Design: v0.4.0 Integrity Remediation

## Evaluator Contract

An evaluator must print exactly one finite numeric score only after performing a real measurement. Generic recipe templates that cannot perform a portable measurement must explain required configuration on stderr and exit 1. Constant success is prohibited. ML and literature templates may remain functional only with controlled fixture tests proving their score changes with input.

## Experiment Result Contract

The server is the sole owner of `improved`, `best_score`, and `successful_iterations`. All result writes execute in one `BEGIN IMMEDIATE` transaction after loading and validating the experiment specification.

Scores and cost fields must be finite; duration and cost fields must be nonnegative. A result marked `is_baseline=true` always derives `improved=false`. Exactly one baseline iteration may exist. Its iteration must be lower than every non-baseline iteration, and a non-baseline result is rejected until that baseline exists. The baseline is always the initial comparison anchor even when it falls outside configured metric bounds; floors and ceilings gate candidate eligibility, not baseline admission. If no eligible candidate improves on it, `best_score` remains the baseline score.

For `strict-improvement`, results are evaluated in ascending iteration order. A non-baseline candidate whose primary score violates a floor or ceiling configured under `spec.metric_name` is rejected before any write. A persisted candidate is improved only when strictly better than the preceding champion according to `metric_direction`; ties are not improvements.

Upserting an existing iteration recomputes every result's derived `improved` value in iteration order in the same transaction. `best_score` is the directional optimum among persisted scores, including the baseline, and `successful_iterations` is the count of recomputed non-baseline improvements.

The public `improved` input is an optional compatibility assertion. If supplied and it disagrees with the submitted row's derived value, the entire transaction rolls back. Unsupported acceptance rules, invalid baseline topology, missing primary comparison state, and non-finite values fail before any write. Responses report the derived value.

## Catalog Snapshot Contract

Read, parse, normalize, and validate the entire authoritative catalog before opening a mutation transaction. Validation includes all four required directories, unique IDs, file/layer agreement, schema validity, valid `composes` references to IDs of the required component layer, and valid `related` references to any existing catalog ID across all layers.

Apply changed upserts, stale deletion, and FTS rebuilding in one `BEGIN IMMEDIATE` transaction. Any validation or database/FTS failure rolls back the complete snapshot and rejects `loadCatalog`; it must not return a successful result containing errors. The standalone loader exits nonzero, and server startup aborts before MCP transport connection. Tests prove catalog rows and FTS query results remain logically unchanged after each failure class.

## Scaffold Contract

Resolve the project root with `realpath` and require it to be an existing directory. Reject a symlinked `autoresearch` directory, symlinked destination, or any resolved destination outside the canonical root.

Generate and validate all three files in a unique staging directory on the same filesystem. When `overwrite=false`, no destination may exist. When `overwrite=true`, move existing regular files to rollback backups before installing staged files. Install every file with same-filesystem rename; if that guarantee is unavailable, fail before modifying destinations.

Register the database experiment only after all files are installed. Any failure during staging, backup, installation, chmod, or database registration restores the exact prior file contents and modes, removes newly created files and staging/backup artifacts, and leaves no experiment row. A newly created empty `autoresearch` directory is removed after rollback, but a pre-existing directory is never removed. Concurrent scaffolds targeting the same canonical project root are rejected or serialized.

Replace any existing generated Run Controls section rather than appending duplicates. Exactly one section shows effective normalized values, including defaults, custom instructions, budget, risk policy, constraints, stopping conditions, metric direction, and evaluator command.

## Migration and Lifecycle Contract

Acquire the migration write lock before checking each migration version and recheck under that lock. Define explicit lifecycle transitions: scaffolded to running/failed; running to paused/completed/failed; paused to running/completed/failed; terminal states remain terminal. Preserve the first start timestamp and set completion only once.

## Recommendation Contract

Budgets contain finite nonnegative values; `max_iterations` and `max_tokens` are integers. For any metric present in both constraint maps, its floor cannot exceed its ceiling. Result scores, catalog rates, and parsed durations are finite.

After trimming, accept only numeric text matching `[0-9]+(?:\.[0-9]+)?`: integers and forms such as `0.5` are accepted; `.5`, `1.`, signed values, and scientific notation are rejected. It must be followed by whitespace and one case-insensitive unit from `s`, `sec`, `secs`, `second`, `seconds`, `m`, `min`, `mins`, `minute`, `minutes`, `h`, `hr`, `hrs`, `hour`, or `hours`. Normalize the value to finite positive seconds. `experiments_per_hour`, when present, must be finite and strictly positive. Compute required throughput as `3600 / max_duration_seconds`. Deterministically filter recipes with an `experiments_per_hour` below that throughput before ranking; recipes without an estimate remain eligible but are identified as unverified. Zero and malformed durations are rejected. Tests prove that changing only the duration constraint can change ordering.

## Dependency Strategy

Set and lock these reviewed minimums: `@modelcontextprotocol/sdk >=1.29.0 <2`, `yaml >=2.8.3 <3`, `zod >=3.25.28 <4`, and exact `zod-to-json-schema 3.25.2`. Keep Biome on major version 1. Regenerate the lockfile and verify the resolved dependency graph contains no version below these floors.

The MCP server supports Bun `>=1.3.10`. Node support applies only to the standalone installer and is Node 22 and 24; remove Node 20 from CI and public support claims. Forgejo Actions uses a digest-pinned Bun image as the deterministic required gate and does not run a mutable latest-Bun advisory. MCP SDK v2 and Biome 2 remain separate follow-ups.

## Release Governance

Forgejo Actions is the protected primary gate. The PR-only workflow grants contents read permission and exposes one required terminal `ci` context, which succeeds only when its `bun`, `node22`, and `node24` dependencies succeed. Merge-blocking CI uses digest-pinned Node and Bun containers, runs `npm pack`, inspects the tarball manifest against an allowlist, and tests from a clean directory outside the checkout. It installs only the generated `.tgz`, then tests both bins, unknown flags, invalid targets, forced installer failure propagation, all curated evaluator contracts, and an MCP initialize/list-tools handshake with a timeout. It records the full commit SHA, toolchain versions, tarball filename, SHA-256, and SHA-512 in the immutable CI log. The same workflow proves two clean packs are byte-identical. No artifact-storage secret is approved for this repository, so the publisher reconstructs the tarball from the exact merged commit in the identical pinned container and may continue only when both hashes match the CI evidence; matching hashes establish byte identity with the tested artifact. Node installer smoke runs on Node 22 and 24; server and evaluator tests run on pinned Bun. The workflow contains no registry credentials, prompts, model responses, PHI, secrets, AI review broker, provider calls, publication, deployment, notifications, or branch mutation.

GitHub remains a branch mirror. After Forgejo merged-main verification, ordinary `main` is mirrored to GitHub before publication. Publishing is an explicitly operator-authorized irreversible step and uses only the byte-identical tarball reconstructed and verified from merged main against recorded CI hashes. Registry smoke verifies version, clean installation, both bins, and MCP handshake. Only after smoke succeeds is the same commit tagged `v0.4.0`; that release tag is then mirrored to GitHub. Failed smoke requires package deprecation, no release tag or release closure, and a new corrected version.
