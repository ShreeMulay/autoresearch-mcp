# autoresearch-mcp

An MCP server that brings Andrej Karpathy's autoresearch pattern to every AI coding session, with a composable technique catalog, experiment scaffolding, and SQLite + FTS5-backed tracking.

## What is Autoresearch?

Autoresearch is a simple but powerful pattern popularized by [Andrej Karpathy's autoresearch project](https://github.com/karpathy/autoresearch), one of the most-starred AI research repositories on GitHub: give an AI agent a real experiment setup, let it modify code, prompts, or configs, run a fixed-time experiment, check whether the target metric improved, keep or discard the change, and repeat.

In Karpathy's framing, that can mean roughly 12 experiments per hour and around 100 overnight. The important idea is broader than any one implementation: if you have a measurable metric, you can ratchet toward better results.

`autoresearch-mcp` packages that pattern as an MCP server so any compatible AI client can discover techniques, scaffold experiments, track iterations, and accumulate meta-learning across projects.

This project is inspired by Karpathy's work, but it is not affiliated with his project and no code was copied.

## Data Safety

Use synthetic, non-sensitive data only; examples and tests use synthetic data only. Do not supply PHI, patient identifiers, PHI-bearing prompts or model responses, clinical records, secrets, or production datasets to this MCP server, its evaluators or review tooling, logs, fixtures, or CI.

## Release Status

Version 0.4.0 is not yet published. It remains pending integrity remediation and npm authentication, and no `v0.4.0` tag exists. The registry commands below are post-release instructions; until publication, use a reviewed source checkout rather than assuming `autoresearch-mcp` is available from npm.

## Quick Start

Runtime requirements:

- MCP server (`autoresearch-mcp`): requires [Bun](https://bun.sh) >= 1.3.10, because the server uses `bun:sqlite`
- Standalone skill installer (`autoresearch-install-skill`): supports Node.js 22 and 24, no Bun needed
- Any MCP-compatible client such as Claude Code or OpenCode

After 0.4.0 is published, install globally (puts both commands on your PATH):

```bash
npm install -g autoresearch-mcp
```

Or, after publication, run without a global install:

```bash
# Start the MCP server (requires Bun)
bunx autoresearch-mcp

# Install the bundled skill (works with Node alone)
npx -p autoresearch-mcp autoresearch-install-skill
```

Note: `npm install -g` succeeds on a machine without Bun, but the `autoresearch-mcp` server command will not run until Bun >= 1.3.10 is installed. The standalone skill installer runs on supported Node.js 22 or 24 alone.

### Install as Skill (Recommended)

`autoresearch-mcp` ships with a skill file that teaches your AI agent the autoresearch methodology: when to use which technique, how to compose recipes, and how to run ratchet loops. The skill is lightweight (~100-400 tokens in context) while the MCP server provides the heavy machinery (catalog search, experiment tracking, scaffolding).

**Skill + MCP = Brain + Hands**

#### OpenCode

```bash
# Install the bundled skill into ~/.opencode/skills/autoresearch
npx -p autoresearch-mcp autoresearch-install-skill --target opencode

# If autoresearch-mcp is already installed globally (requires Bun;
# on Node-only machines use autoresearch-install-skill instead):
autoresearch-mcp install-skill --target opencode
```

Skills are auto-discovered from `~/.opencode/skills/`. The skill lazy-loads when your agent encounters optimization problems.

#### Claude Code

```bash
npx -p autoresearch-mcp autoresearch-install-skill --target claude
```

#### pi.dev

```bash
pi --skill $(npm root -g)/autoresearch-mcp/skills/autoresearch/SKILL.md
```

The installer copies skill files by default so `npx` temporary package caches do not leave broken symlinks. Use `--dry-run` to preview changes or `--overwrite` to replace an existing skill directory.

### Install as MCP Server (Machinery)

The MCP server provides tools and state. Install alongside the skill for full capability.

#### Claude Code

Add this to your MCP settings:

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

#### OpenCode

Add this to `~/.config/opencode/opencode.json`:

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
2. Scaffold an experiment with a program and evaluator harness.
3. Run iterations against a measurable metric.
4. Keep improvements, discard regressions.
5. Track costs, timing, and outcomes.
6. Reuse what works across future projects.

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

The server exposes 12 MCP tools.

| Tool | Description |
| --- | --- |
| `search_techniques` | Search the catalog by query, or list all techniques when the query is empty. |
| `get_technique` | Return full details for a technique by ID. |
| `suggest_technique` | Describe a problem and get a recommended approach. |
| `register_experiment` | Create a tracked experiment record. |
| `update_experiment` | Update experiment status with automatic timestamps. |
| `log_result` | Log an iteration result with score, time, token, and dollar tracking. |
| `get_experiment` | Retrieve experiment details and optional iteration history. |
| `list_experiments` | List experiments filtered by status or project. |
| `scaffold_experiment` | Generate `program.md`, `eval.sh`, and `results.tsv` from a recipe. |
| `get_template` | Return a recipe template file. |
| `get_server_info` | Return server version, catalog stats, and the active database path. |
| `log_technique_outcome` | Record what worked for cross-project meta-learning. |

## Usage Examples

### Conversational workflow

```text
You: "I want to optimize my chatbot's system prompt. I have 50 test questions."

Agent calls: suggest_technique(problem: "optimize chatbot prompt with eval set")
-> Recommends: prompt-optimization recipe
   (hill-climbing + llm-as-judge + single-ratchet)

Agent calls: scaffold_experiment(recipe_id: "prompt-optimization", ...)
-> Creates: autoresearch/program.md, eval.sh, results.tsv

You: "Run the ratchet loop"
Agent: reads program.md, edits prompt, runs eval.sh, logs results...

After 10 iterations: Score improved from 62 to 94 (+52%)
```

### Scripted MCP flow

If you prefer explicit tool orchestration, the lifecycle looks like this:

```text
1. suggest_technique(problem="reduce API latency without hurting quality")
2. scaffold_experiment(recipe_id="code-performance", project_path="/repo", metric_name="requests/sec")
3. update_experiment(experiment_id="...", status="running")
4. log_result(iteration=0, score=1100, is_baseline=true, improved=false, change_description="baseline before candidate changes")
5. log_result(iteration=1, score=1180, change_description="inlined hot path")
6. log_result(iteration=2, score=1165, change_description="added extra serialization")
7. get_experiment(experiment_id="...", include_results=true)
8. log_technique_outcome(technique_id="code-performance", domain="backend", outcome="success")
```

Log exactly one baseline before candidate iterations. Baselines are never improvements, so the explicit `improved=false` assertion matches the server-derived result. For candidates, omit `improved` as above and let the server derive it; if supplied, the assertion must match the server-derived result.

After scaffolding, your agent gets a working starting point:

- `autoresearch/program.md` for the loop instructions
- `autoresearch/eval.sh` for the evaluation harness
- `autoresearch/results.tsv` for iteration history

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

### Claude Code

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

### OpenCode

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

### Other MCP clients

Any client that supports launching a local stdio MCP server can use `autoresearch-mcp` with the same pattern:

- command: `bunx`
- args: `autoresearch-mcp`

If your client expects a single executable command, point it at the same Bun-based invocation.

## Roadmap

- Phase 0.5: Catalog discovery + FTS5 search
- Phase 1: Experiment tracking + scaffolding
- **Phase 2: Skill + tests + public release** (current)
- Phase 3: Autonomous runner with agent-driven execution and approval-aware loops
- Phase 4: Docker sandbox for safer code execution and isolated experiments
- Phase 5: Nightcrawler-style bounded episodes for longer autonomous optimization runs

The direction is simple: start with trustworthy building blocks, then expand toward increasingly autonomous experiment execution.

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
