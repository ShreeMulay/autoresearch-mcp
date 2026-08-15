#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXPECTED_BUN_VERSION="${EXPECTED_BUN_VERSION:-1.3.10}"
readonly EXPECTED_NODE_VERSION="${EXPECTED_NODE_VERSION:-v22.22.1}"
readonly EXPECTED_NPM_VERSION="${EXPECTED_NPM_VERSION:-10.9.4}"
readonly REPO_ROOT="$(realpath "$(dirname "${BASH_SOURCE[0]}")/..")"
readonly EXPECTED_MANIFEST="$REPO_ROOT/ci/expected-package-manifest.txt"
readonly RELEASE_ARTIFACT="$REPO_ROOT/ci/release-artifact.json"
ARTIFACT_OUTPUT=''

while (($#)); do
  case "$1" in
    --artifact-output)
      (($# >= 2)) || { printf 'package-smoke: --artifact-output requires an absolute directory\n' >&2; exit 64; }
      ARTIFACT_OUTPUT=$2
      shift 2
      ;;
    *) printf 'package-smoke: unknown argument: %s\n' "$1" >&2; exit 64 ;;
  esac
done

if [[ -n "$ARTIFACT_OUTPUT" ]]; then
  [[ "$ARTIFACT_OUTPUT" == /* ]] || { printf 'package-smoke: --artifact-output must be absolute\n' >&2; exit 64; }
  mkdir -p "$ARTIFACT_OUTPUT"
  ARTIFACT_OUTPUT="$(realpath "$ARTIFACT_OUTPUT")"
fi
WORK_DIR_RAW=''
if ! WORK_DIR_RAW="$(mktemp -d)"; then
  printf 'package-smoke: mktemp failed\n' >&2
  exit 1
fi
[[ -n "$WORK_DIR_RAW" && "$WORK_DIR_RAW" == /* ]] || {
  printf 'package-smoke: mktemp must return a nonempty absolute path\n' >&2
  exit 1
}
readonly WORK_DIR="$(realpath "$WORK_DIR_RAW")"
[[ "$WORK_DIR" != "$REPO_ROOT" && "$WORK_DIR" != "$REPO_ROOT"/* ]] || {
  printf 'package-smoke: refusing checkout as sandbox\n' >&2
  exit 1
}
readonly LOG_DIR="${PACKAGE_SMOKE_LOG_DIR:-$WORK_DIR/logs}"

mkdir -p "$LOG_DIR"
cd "$WORK_DIR"
[[ "$PWD" != "$REPO_ROOT" && "$PWD" != "$REPO_ROOT"/* ]] || {
	printf 'package-smoke: sandbox must be external to checkout\n' >&2
	exit 1
}

readonly COMMIT_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
readonly PACKAGE_VERSION="$(node -p "require('$REPO_ROOT/package.json').version")"
readonly TARBALL="autoresearch-mcp-${PACKAGE_VERSION}.tgz"
readonly LOG_FILE="$LOG_DIR/package-smoke-${COMMIT_SHA}.log"

touch "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

cleanup() {
  local status=$?
  chmod 0444 "$LOG_FILE" 2>/dev/null || true
  rm -rf "$WORK_DIR"
  exit "$status"
}
trap cleanup EXIT

fail() {
  printf 'package-smoke: %s\n' "$*" >&2
  exit 1
}

expect_failure() {
  local description=$1
  shift
  if "$@"; then
    fail "$description unexpectedly succeeded"
  fi
}

readonly BUN_VERSION="$(bun --version)"
readonly NODE_VERSION="$(node --version)"
readonly NPM_VERSION="$(npm --version)"
[[ "$BUN_VERSION" == "$EXPECTED_BUN_VERSION" ]] || fail "expected Bun $EXPECTED_BUN_VERSION, got $BUN_VERSION"
[[ "$NODE_VERSION" == "$EXPECTED_NODE_VERSION" ]] || fail "expected Node $EXPECTED_NODE_VERSION, got $NODE_VERSION"
[[ "$NPM_VERSION" == "$EXPECTED_NPM_VERSION" ]] || fail "expected npm $EXPECTED_NPM_VERSION, got $NPM_VERSION"

printf 'commit=%s\n' "$COMMIT_SHA"
printf 'bun=%s node=%s npm=%s\n' "$BUN_VERSION" "$NODE_VERSION" "$NPM_VERSION"

mkdir -p "$WORK_DIR/pack-1" "$WORK_DIR/pack-2" "$WORK_DIR/home"
for destination in "$WORK_DIR/pack-1" "$WORK_DIR/pack-2"; do
  env -i HOME="$WORK_DIR/home" PATH="$PATH" npm_config_userconfig=/dev/null npm_config_update_notifier=false \
    npm pack "$REPO_ROOT" --pack-destination "$destination" --ignore-scripts --loglevel error >/dev/null
done

readonly FIRST_TGZ="$WORK_DIR/pack-1/$TARBALL"
readonly SECOND_TGZ="$WORK_DIR/pack-2/$TARBALL"
[[ -f "$FIRST_TGZ" && -f "$SECOND_TGZ" ]] || fail "npm pack did not create $TARBALL twice"

readonly SHA256_FIRST="$(sha256sum "$FIRST_TGZ" | cut -d' ' -f1)"
readonly SHA256_SECOND="$(sha256sum "$SECOND_TGZ" | cut -d' ' -f1)"
readonly SHA512_FIRST="$(sha512sum "$FIRST_TGZ" | cut -d' ' -f1)"
readonly SHA512_SECOND="$(sha512sum "$SECOND_TGZ" | cut -d' ' -f1)"
[[ "$SHA256_FIRST" == "$SHA256_SECOND" ]] || fail "repeated npm pack SHA-256 mismatch"
[[ "$SHA512_FIRST" == "$SHA512_SECOND" ]] || fail "repeated npm pack SHA-512 mismatch"
node - "$RELEASE_ARTIFACT" "$SHA256_FIRST" "$SHA512_FIRST" "$PACKAGE_VERSION" <<'EOF'
const fs = require("node:fs");
const [path, sha256, sha512, version] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(path, "utf8"));
const keys = ["integrity", "package", "publisher", "registry", "registryReads", "schemaVersion", "sha256", "sha512", "version"].sort();
if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys)) throw new Error("release artifact has an open or incomplete schema");
if (value.schemaVersion !== 1 || value.package !== "autoresearch-mcp" || value.version !== version || value.registry !== "https://registry.npmjs.org/" || value.publisher !== "shreemulay") throw new Error("release artifact identity mismatch");
if (!/^[a-f0-9]{64}$/.test(value.sha256) || !/^[a-f0-9]{128}$/.test(value.sha512)) throw new Error("release artifact digest encoding mismatch");
if (value.sha256 !== sha256 || value.sha512 !== sha512) throw new Error("packed artifact digest mismatch");
if (value.integrity !== `sha512-${Buffer.from(sha512, "hex").toString("base64")}`) throw new Error("release artifact SRI mismatch");
const reads = value.registryReads;
const readKeys = ["attempts", "backoffSeconds"].sort();
if (!reads || JSON.stringify(Object.keys(reads).sort()) !== JSON.stringify(readKeys) || !Number.isInteger(reads.attempts) || reads.attempts < 2 || reads.attempts > 5 || !Array.isArray(reads.backoffSeconds) || reads.backoffSeconds.length !== reads.attempts || reads.backoffSeconds.some((n) => !Number.isInteger(n) || n < 0 || n > 30)) throw new Error("invalid bounded registry-read policy");
EOF
printf 'artifact=%s sha256=%s sha512=%s\n' "$TARBALL" "$SHA256_FIRST" "$SHA512_FIRST"

tar -tzf "$FIRST_TGZ" | LC_ALL=C sort > "$WORK_DIR/manifest.txt"
readonly DENYLIST='(^|/)(\.env($|\.)|\.git($|/)|\.slim($|/)|node_modules($|/)|tests?($|/)|worktrees?($|/)|[^/]+\.(db|sqlite|sqlite3|log))'
while IFS= read -r entry; do
  [[ ! "$entry" =~ $DENYLIST ]] || fail "manifest entry is denied: $entry"
done < "$WORK_DIR/manifest.txt"
diff -u "$EXPECTED_MANIFEST" "$WORK_DIR/manifest.txt" || fail "packed manifest differs from expected manifest"
node - "$WORK_DIR/manifest.txt" <<'EOF'
const fs = require("node:fs");
const entries = fs.readFileSync(process.argv[2], "utf8").trim().split("\n");
const count = (prefix, suffix) => entries.filter((entry) => entry.startsWith(prefix) && entry.endsWith(suffix)).length;
const expectedCounts = { evaluators: 8, patterns: 6, recipes: 8, strategies: 8 };
for (const [layer, expected] of Object.entries(expectedCounts)) {
  const actual = count(`package/catalog/${layer}/`, ".yaml");
  if (actual !== expected) throw new Error(`${layer} catalog count: expected ${expected}, got ${actual}`);
}
const templates = ["code-performance", "config-tuning", "content-revision", "general-ratchet", "literature-synthesis", "ml-training", "prompt-optimization", "test-amplification"];
for (const template of templates) {
  for (const file of ["eval.sh", "program.md"]) {
    const entry = `package/catalog/templates/${template}/${file}`;
    if (!entries.includes(entry)) throw new Error(`missing template entry: ${entry}`);
  }
}
const required = [
  "package/ACKNOWLEDGMENTS.md", "package/CHANGELOG.md", "package/CONTRIBUTING.md", "package/LICENSE", "package/NOTICE", "package/README.md",
  "package/bin/autoresearch-install-skill", "package/bin/autoresearch-mcp", "package/scripts/install-skill.js", "package/skills/autoresearch/SKILL.md",
  "package/skills/autoresearch/references/composition-patterns.md", "package/skills/autoresearch/references/technique-index.md", "package/skills/autoresearch/references/workflow-examples.md",
];
for (const entry of required) if (!entries.includes(entry)) throw new Error(`missing required package entry: ${entry}`);
EOF
printf 'manifest_entries=%s\n' "$(wc -l < "$WORK_DIR/manifest.txt" | tr -d ' ')"

mkdir -p "$WORK_DIR/consumer"
cd "$WORK_DIR/consumer"
env -i HOME="$WORK_DIR/home" PATH="$PATH" npm_config_userconfig=/dev/null npm_config_update_notifier=false \
  npm init --yes >/dev/null
env -i HOME="$WORK_DIR/home" PATH="$PATH" npm_config_userconfig=/dev/null npm_config_update_notifier=false \
  npm install --ignore-scripts --no-audit --no-fund "$FIRST_TGZ" >/dev/null
env -i HOME="$WORK_DIR/home" PATH="$PATH" npm_config_userconfig=/dev/null npm_config_update_notifier=false \
  npm audit --omit=dev
env -i HOME="$WORK_DIR/home" PATH="$PATH" npm_config_userconfig=/dev/null npm_config_update_notifier=false \
  npm ls --all --json > "$WORK_DIR/consumer-graph.json"
node - "$WORK_DIR/consumer-graph.json" <<'EOF'
const fs = require("node:fs");
const graph = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const floors = { "@hono/node-server": "1.19.15", "body-parser": "2.3.0", "fast-uri": "3.1.3", "hono": "4.12.34", "ip-address": "10.4.0", "qs": "6.15.3" };
const found = new Map(Object.keys(floors).map((name) => [name, []]));
const visit = (node) => {
  for (const [name, dependency] of Object.entries(node.dependencies ?? {})) {
    if (found.has(name) && dependency.version) found.get(name).push(dependency.version);
    visit(dependency);
  }
};
const compare = (left, right) => {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};
visit(graph);
for (const [name, floor] of Object.entries(floors)) {
  const versions = found.get(name);
  if (versions.length === 0) throw new Error(`consumer graph is missing ${name}`);
  for (const version of versions) if (compare(version, floor) < 0) throw new Error(`${name}@${version} is below safe floor ${floor}`);
  console.log(`consumer-floor=${name}>=${floor} installed=${[...new Set(versions)].join(",")}`);
}
EOF
readonly INSTALLED="$WORK_DIR/consumer/node_modules/autoresearch-mcp"
readonly MAIN_BIN="$WORK_DIR/consumer/node_modules/.bin/autoresearch-mcp"
readonly INSTALLER_BIN="$WORK_DIR/consumer/node_modules/.bin/autoresearch-install-skill"
[[ -x "$MAIN_BIN" && -x "$INSTALLER_BIN" ]] || fail "installed package bins are not executable"

env -i HOME="$WORK_DIR/home" PATH="$PATH" "$MAIN_BIN" --help
env -i HOME="$WORK_DIR/home" PATH="$PATH" "$INSTALLER_BIN" --help
env -i HOME="$WORK_DIR/home" PATH="$PATH" "$INSTALLER_BIN" --dry-run --target opencode
env -i HOME="$WORK_DIR/home" PATH="$PATH" "$MAIN_BIN" install-skill --dry-run --target claude
expect_failure "main-bin unknown flag" env -i HOME="$WORK_DIR/home" PATH="$PATH" "$MAIN_BIN" --bogus
expect_failure "main-bin installer unknown flag" env -i HOME="$WORK_DIR/home" PATH="$PATH" "$MAIN_BIN" install-skill --dryrun
expect_failure "main-bin installer unknown target" env -i HOME="$WORK_DIR/home" PATH="$PATH" "$MAIN_BIN" install-skill --target bogus
expect_failure "installer unknown flag" env -i HOME="$WORK_DIR/home" PATH="$PATH" "$INSTALLER_BIN" --dryrun
expect_failure "installer unknown target" env -i HOME="$WORK_DIR/home" PATH="$PATH" "$INSTALLER_BIN" --target bogus
printf 'not a directory\n' > "$WORK_DIR/home-file"
expect_failure "forced installer filesystem failure" env -i HOME="$WORK_DIR/home-file" PATH="$PATH" "$INSTALLER_BIN" --target opencode
expect_failure "forced main-bin installer filesystem failure" env -i HOME="$WORK_DIR/home-file" PATH="$PATH" "$MAIN_BIN" install-skill --target claude

readonly EVALUATORS=(prompt-optimization code-performance config-tuning content-revision general-ratchet test-amplification)
for evaluator in "${EVALUATORS[@]}"; do
  mkdir -p "$WORK_DIR/evaluator-$evaluator"
  expect_failure "$evaluator evaluator without configured score" \
    bash -c 'cd "$1" && exec env -i HOME="$2" PATH="$3" bash "$4"' _ \
      "$WORK_DIR/evaluator-$evaluator" "$WORK_DIR/home" "$PATH" "$INSTALLED/catalog/templates/$evaluator/eval.sh"
done
mkdir -p "$WORK_DIR/evaluator-ml" "$WORK_DIR/evaluator-literature"
printf '{"score":0.25}\n' > "$WORK_DIR/evaluator-ml/metrics.json"
readonly ML_FIRST="$(cd "$WORK_DIR/evaluator-ml" && env -i HOME="$WORK_DIR/home" PATH="$PATH" bash "$INSTALLED/catalog/templates/ml-training/eval.sh")"
printf '{"score":0.75}\n' > "$WORK_DIR/evaluator-ml/metrics.json"
readonly ML_SECOND="$(cd "$WORK_DIR/evaluator-ml" && env -i HOME="$WORK_DIR/home" PATH="$PATH" bash "$INSTALLED/catalog/templates/ml-training/eval.sh")"
[[ "$ML_FIRST" == "0.25" && "$ML_SECOND" == "0.75" ]] || fail "ml-training evaluator contract failed"
printf 'A claim without a citation.\n' > "$WORK_DIR/evaluator-literature/synthesis.md"
readonly LIT_FIRST="$(cd "$WORK_DIR/evaluator-literature" && env -i HOME="$WORK_DIR/home" PATH="$PATH" bash "$INSTALLED/catalog/templates/literature-synthesis/eval.sh")"
printf 'A supported claim [Source 2025].\n' > "$WORK_DIR/evaluator-literature/synthesis.md"
readonly LIT_SECOND="$(cd "$WORK_DIR/evaluator-literature" && env -i HOME="$WORK_DIR/home" PATH="$PATH" bash "$INSTALLED/catalog/templates/literature-synthesis/eval.sh")"
[[ "$LIT_FIRST" != "$LIT_SECOND" ]] || fail "literature-synthesis evaluator did not respond to fixture change"

cat > "$WORK_DIR/requests.jsonl" <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"package-smoke","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_server_info","arguments":{}}}
EOF
env -i HOME="$WORK_DIR/home" PATH="$PATH" AUTORESEARCH_DB_PATH=:memory: \
  timeout 20 "$MAIN_BIN" < "$WORK_DIR/requests.jsonl" > "$WORK_DIR/responses.jsonl"
node - "$WORK_DIR/responses.jsonl" "$PACKAGE_VERSION" <<'EOF'
const fs = require("node:fs");
const [path, version] = process.argv.slice(2);
const messages = fs.readFileSync(path, "utf8").trim().split("\n").map(JSON.parse);
const byId = new Map(messages.filter((message) => message.id).map((message) => [message.id, message]));
if (byId.get(1)?.result?.serverInfo?.version !== version) throw new Error("initialize server version mismatch");
const expectedTools = ["get_experiment", "get_server_info", "get_technique", "get_template", "list_experiments", "log_result", "log_technique_outcome", "register_experiment", "scaffold_experiment", "search_techniques", "suggest_technique", "update_experiment"];
const actualTools = (byId.get(2)?.result?.tools ?? []).map((tool) => tool.name).sort();
if (JSON.stringify(actualTools) !== JSON.stringify(expectedTools)) throw new Error(`tool list mismatch: ${actualTools.join(",")}`);
const serverInfo = JSON.parse(byId.get(3)?.result?.content?.[0]?.text ?? "null");
if (serverInfo?.version !== version) throw new Error("get_server_info version mismatch");
if (serverInfo?.catalog?.total !== 30) throw new Error(`catalog total mismatch: ${serverInfo?.catalog?.total}`);
EOF

if [[ -n "$ARTIFACT_OUTPUT" ]]; then
  readonly VERIFIED_ARTIFACT="$ARTIFACT_OUTPUT/$TARBALL"
  cp -- "$FIRST_TGZ" "$VERIFIED_ARTIFACT"
  chmod 0444 "$VERIFIED_ARTIFACT"
  printf 'verified_artifact=%s\n' "$VERIFIED_ARTIFACT"
fi

printf 'package-smoke=passed log=%s\n' "$LOG_FILE"
