# autoresearch-mcp

An MCP server that brings Andrej Karpathy's autoresearch pattern to every AI coding session, with a composable technique catalog, experiment scaffolding, and SQLite + FTS5-backed tracking.

## What is Autoresearch?

Autoresearch is a simple but powerful pattern popularized by [Andrej Karpathy's autoresearch project](https://github.com/karpathy/autoresearch), one of the most-starred AI research repositories on GitHub: give an AI agent a real experiment setup, let it modify code, prompts, or configs, run a fixed-time experiment, check whether the target metric improved, keep or discard the change, and repeat.

In Karpathy's framing, that can mean roughly 12 experiments per hour and around 100 overnight. The important idea is broader than any one implementation: if you have a measurable metric, you can ratchet toward better results.

`autoresearch-mcp` packages that pattern as an MCP server so any compatible AI client can discover techniques, scaffold experiments, and track bounded human/agent-driven iterations. It does not execute an autonomous optimization loop.

This project is inspired by Karpathy's work, but it is not affiliated with his project and no code was copied.

## Data Safety

Use synthetic, non-sensitive data only; examples and tests use synthetic data only. Do not supply PHI, patient identifiers, PHI-bearing prompts or model responses, clinical records, secrets, or production datasets to this MCP server, its evaluators or review tooling, logs, fixtures, or CI.

## Release Status

Version 0.4.0 is not yet published or tagged. Package safety and protected Forgejo CI are in place; the remaining release work is the authenticated npm publish, installed-package smoke, and Forgejo-first tag push described in [CONTRIBUTING.md](./CONTRIBUTING.md). Until those steps succeed, use a reviewed source checkout rather than assuming `autoresearch-mcp` is available from npm.

## Quick Start

Runtime requirements:

- MCP server: requires [Bun](https://bun.sh) >= 1.3.10, because the server uses `bun:sqlite`
- Standalone skill installer (`bin/autoresearch-install-skill`): supports Node.js 22 and 24, no Bun needed
- Any MCP-compatible client such as Claude Code or OpenCode

### Install from source (works today)

`autoresearch-mcp` is not yet published to npm, so install from a reviewed source checkout. Pin an explicit revision or tag instead of tracking a moving branch:

```bash
# Forgejo (primary) or the GitHub mirror
git clone ssh://git@git.thekidneyexperts.com:2222/thekidneyexperts/autoresearch-mcp.git /absolute/path/to/autoresearch-mcp
# git clone https://github.com/ShreeMulay/autoresearch-mcp.git /absolute/path/to/autoresearch-mcp
cd /absolute/path/to/autoresearch-mcp
git checkout <reviewed-commit-or-tag>
bun install --frozen-lockfile
```

Point your MCP client at the checkout with `bun`:

Claude Code (MCP settings):

```json
{
  "mcpServers": {
    "autoresearch": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/autoresearch-mcp/src/index.ts"]
    }
  }
}
```

OpenCode (`~/.config/opencode/opencode.json`):

```json
{
  "mcp": {
    "autoresearch": {
      "type": "local",
      "command": ["bun", "run", "/absolute/path/to/autoresearch-mcp/src/index.ts"]
    }
  }
}
```

Install the bundled skill from the checkout (Node.js 22 or 24 is enough):

```bash
node /absolute/path/to/autoresearch-mcp/bin/autoresearch-install-skill --target opencode
node /absolute/path/to/autoresearch-mcp/bin/autoresearch-install-skill --target claude
```

The installer copies skill files by default. Use `--dry-run` to preview changes, `--symlink` to link to the checkout instead of copying, or `--overwrite` to replace an existing skill. Overwrite stages the new skill beside the target, moves the existing target to a backup, promotes the staged copy, then removes the backup; if promotion fails it restores the original (or prints the backup path if restoring fails too). This guards against losing the existing skill on ordinary failures but is not crash-atomic.

### Install from npm (after publication)

<!-- after-npm-publication -->
> **After npm publication only** — `autoresearch-mcp` is not yet on npm; these commands will fail (or could resolve to an unrelated package) until then.

After 0.4.0 is published, install globally (puts both commands on your PATH):

```bash
npm install -g autoresearch-mcp
```

Or run without a global install:

```bash
# Start the MCP server (requires Bun)
bunx autoresearch-mcp

# Install the bundled skill (works with Node alone)
npx -p autoresearch-mcp autoresearch-install-skill
```

Note: `npm install -g` succeeds on a machine without Bun, but the `autoresearch-mcp` server command will not run until Bun >= 1.3.10 is installed. The standalone skill installer runs on supported Node.js 22 or 24 alone.

Skill install from the published package:

```bash
# OpenCode: installs into ~/.opencode/skills/autoresearch
npx -p autoresearch-mcp autoresearch-install-skill --target opencode

# Claude Code: installs into ~/.claude/skills/autoresearch
npx -p autoresearch-mcp autoresearch-install-skill --target claude

# If autoresearch-mcp is already installed globally (requires Bun;
# on Node-only machines use autoresearch-install-skill instead):
autoresearch-mcp install-skill --target opencode

# pi.dev
pi --skill $(npm root -g)/autoresearch-mcp/skills/autoresearch/SKILL.md
```

MCP server configuration using the published package:

Claude Code:

```json
{
  "mcpServers": {
    "autoresearch": {
      "command": "bunx",
      "args": ["autoresearch-mcp"]
    }
  }
}
```

OpenCode:

```json
{
  "mcp": {
    "autoresearch": {
      "type": "local",
      "command": ["bunx", "autoresearch-mcp"]
    }
  }
}
```

<!-- /after-npm-publication -->

### Skill + MCP = Brain + Hands

`autoresearch-mcp` ships with a skill file that teaches your AI agent the autoresearch methodology: when to use which technique, how to compose recipes, and how to run ratchet loops. The skill is lightweight (~100-400 tokens in context) while the MCP server provides the heavy machinery (catalog search, experiment tracking, scaffolding). Skills are auto-discovered from `~/.opencode/skills/` or `~/.claude/skills/` and lazy-load when your agent encounters optimization problems.

Once connected, ask your agent things like:

- "What autoresearch technique should I use for prompt optimization?"
- "Scaffold a code-performance experiment for this project."
- "Log this iteration result and track the total cost."

## How It Works

At the core is a ratchet loop:

```text
Edit artifact -> Run evaluator -> Score improved? -> Yes: Keep -> Repeat
                                                  -> No: Revert -> Repeat
```

The server gives your agent the pieces needed to run that loop in a structured way:

1. Pick a technique or recipe.
2. Scaffold an experiment with a program and evaluator harness; this also registers it with status `scaffolded`. Save the returned Experiment ID.
3. Configure the evaluator, then, using that ID, log exactly one iteration 0 baseline with `is_baseline=true`. The first successful `log_result` automatically moves a `scaffolded` experiment to `running` and sets `started_at`; paused, completed, and failed experiments are never changed by logging.
4. Run bounded candidate iterations against a measurable metric. Keep improvements, discard regressions.
5. Track costs, timing, and experiment history, and stop at the declared budget, an approval point, a safety concern, or a supervisor's request. Budgets and approval requirements are operator instructions; the server records them but does not enforce them.
6. Close the run with `update_experiment(status="completed")`.

## Technique Catalog

`autoresearch-mcp` ships with a 30-item catalog organized into four composable layers.

### 1. Search Strategies

These define how candidate changes are proposed.

- `hill-climbing`
- `evolutionary`
- `bayesian-optimization`
- `beam-search`
- `multi-armed-bandit`
- `simulated-annealing`
- `ablation-elimination`
- `self-refine`

### 2. Evaluators

These define how candidates are scored.

- `benchmark-harness`
- `binary-evaluator`
- `rubric-scorer`
- `llm-as-judge`
- `pairwise-comparison`
- `cost-latency-evaluator`
- `human-approval-gate`
- `regression-detector`

### 3. Execution Patterns

These define how the loop is run and controlled.

- `single-ratchet`
- `two-loop`
- `bounded-episode`
- `branch-and-merge`
- `champion-challenger`
- `checkpoint-and-resume`

### 4. Recipes

Recipes compose a strategy, evaluator, and execution pattern into a ready-to-use starting point.

- `prompt-optimization`
- `code-performance`
- `config-tuning`
- `content-revision`
- `test-amplification`
- `ml-training`
- `literature-synthesis`
- `general-ratchet`

## MCP Tools

The server exposes 11 MCP tools.

| Tool | Description |
| --- | --- |
| `search_techniques` | Search the catalog by query, or list all techniques when the query is empty. |
| `get_technique` | Return technique details, recipe composition, and examples by ID (use `get_template` for template files). |
| `suggest_technique` | Describe a problem and get a recommended approach. |
| `register_experiment` | Create a tracked record for an existing setup, as an alternative to scaffolding. |
| `update_experiment` | Update experiment status (for example `completed`) with automatic timestamps. |
| `log_result` | Log an iteration result (iteration must be a safe nonnegative integer) with score, time, token, and dollar tracking. The first successful log starts a scaffolded experiment. |
| `get_experiment` | Retrieve experiment details, persisted controls (acceptance rule, stopping conditions, budget, risk policy including `requires_approval`, constraints), and optional iteration history (`include_results`, capped at 200 results). |
| `list_experiments` | List experiments filtered by status or project. |
| `scaffold_experiment` | Generate `program.md`, `eval.sh`, and `results.tsv` from a recipe and return the auto-registered Experiment ID. |
| `get_template` | Return a recipe template file. |
| `get_server_info` | Return server version, catalog stats, and the active database path. |

## Usage Examples

### Conversational workflow

```text
You: "I want to optimize my chatbot's system prompt. I have 50 test questions."

Agent calls: suggest_technique(problem: "optimize chatbot prompt with eval set")
-> Recommends: prompt-optimization recipe
   (hill-climbing + llm-as-judge + single-ratchet)

Agent calls: scaffold_experiment(recipe_id: "prompt-optimization", ...)
-> Creates: autoresearch/program.md, autoresearch/eval.sh, autoresearch/results.tsv
-> Returns: Experiment ID (reuse this for every tracking call)

You: "Help me run a bounded ratchet iteration"
Agent: reads program.md, configures the evaluator, logs the baseline using the returned ID (this starts the run), proposes an edit, runs `autoresearch/eval.sh` from the project root, and logs the result under human supervision, stopping at the budget or any approval point.

After 10 iterations: Score improved from 62 to 94 (+52%)
```

### Scripted MCP flow

If you prefer explicit tool orchestration, the lifecycle looks like this:

```text
1. suggest_technique(problem="reduce API latency without hurting quality")
2. scaffold_experiment(recipe_id="code-performance", project_path="/repo", metric_name="requests/sec") -> Experiment ID: exp-id
3. (configure autoresearch/eval.sh; the placeholder evaluator exits 1 until configured)
4. log_result(experiment_id="exp-id", iteration=0, score=1100, is_baseline=true, improved=false, change_description="baseline before candidate changes")  -> scaffolded becomes running
5. log_result(experiment_id="exp-id", iteration=1, score=1180, change_description="inlined hot path")
6. log_result(experiment_id="exp-id", iteration=2, score=1165, change_description="added extra serialization")
7. get_experiment(experiment_id="exp-id", include_results=true)
8. update_experiment(experiment_id="exp-id", status="completed")
```

No separate `update_experiment(status="running")` call is needed: the first successful `log_result` starts a scaffolded experiment. `iteration` must be a safe nonnegative integer.

Log exactly one iteration 0 baseline before candidate iterations. Baselines are never improvements, so the explicit `improved=false` assertion matches the server-derived result. For candidates, omit `improved` as above and let the server derive it; if supplied, the assertion must match the server-derived result. Run the scaffold evaluator as `autoresearch/eval.sh` from the project root.

After scaffolding, your agent gets a working starting point:

- `autoresearch/program.md` for the loop instructions
- `autoresearch/eval.sh` for the evaluation harness
- `autoresearch/results.tsv` for manually maintained iteration history

Do not call `register_experiment` after scaffolding: the experiment is already registered. For existing setups that do not need generated files, use `register_experiment` instead and reuse its returned ID. `log_result` updates SQLite only; it does not append to, import, or automatically synchronize `results.tsv`.

Generated programs use bounded continuation: keep iterating only while within budget, and stop at the budget, an approval point, a safety concern, or a supervisor's request. If scaffolding reports that a scaffold operation is already in progress for the project, wait for it to finish; only remove a leftover `.autoresearch-scaffold.lock` directory after confirming no scaffold is running.

## Example Domains

Anything with a measurable target can use the pattern.

| Domain | Target | Evaluator Example |
| --- | --- | --- |
| Prompt engineering | System prompts | Eval set accuracy |
| Code performance | Source code | Benchmark score |
| Config tuning | Config files | Performance metric |
| Content quality | Articles and docs | Quality rubric score |
| Test coverage | Test suites | Coverage percentage |
| ML training | Training code | Validation loss |

## Recipes

Recipes are the fastest way to get started because they encode a practical composition of the three lower layers:

```text
recipe = search strategy + evaluator + execution pattern
```

For example:

- `prompt-optimization` combines a search strategy suited to prompt mutation, an evaluator that can score prompt outputs, and a ratchet pattern that preserves improvements.
- `code-performance` pairs code changes with benchmark-driven evaluation.
- `general-ratchet` gives you a flexible default when your domain is unusual but still measurable.

You can use recipes as-is, inspect their parts with `get_technique`, or search the catalog to build your own combination.

## Configuration

Use the source-checkout configuration from [Install from source](#install-from-source-works-today) today:

- command: `bun`
- args: `run`, `/absolute/path/to/autoresearch-mcp/src/index.ts`

Any client that supports launching a local stdio MCP server can use that pattern. If your client expects a single executable command, point it at the same Bun-based invocation.

<!-- after-npm-publication -->
> **After npm publication only** — `autoresearch-mcp` is not yet on npm; these commands will fail (or could resolve to an unrelated package) until then.

After publication, the equivalent registry-based launch is command `bunx` with args `autoresearch-mcp` (see [Install from npm](#install-from-npm-after-publication) for full Claude Code and OpenCode JSON).

<!-- /after-npm-publication -->

## Roadmap

- Phase 0.5: Catalog discovery + FTS5 search
- Phase 1: Experiment tracking + scaffolding
- **Phase 2: Skill + tests + public release** (current)
- Phase 3: Autonomous runner with agent-driven execution and approval-aware loops
- Phase 4: Docker sandbox for safer code execution and isolated experiments
- Phase 5: Nightcrawler-style bounded episodes for longer autonomous optimization runs

These are future roadmap items, not current product capabilities. The current release is limited to discovery, scaffolding, and tracked human/agent-driven iteration.

## Inspired By

This project is prominently inspired by Andrej Karpathy's autoresearch work:

- GitHub: [karpathy/autoresearch](https://github.com/karpathy/autoresearch)
- Posts and discussion: [@karpathy on X](https://x.com/karpathy)

`autoresearch-mcp` adapts the underlying pattern for MCP-native workflows so coding agents can use it across prompts, code, configs, content, tests, and research tasks.

It is inspired by Karpathy's idea, not affiliated with his project, and no code was copied.

## Contributing

Contributions are welcome. Please see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[Apache-2.0](./LICENSE)
