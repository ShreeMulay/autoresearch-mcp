# Acknowledgments

## Andrej Karpathy

This project is inspired by [autoresearch](https://github.com/karpathy/autoresearch) by Andrej Karpathy. The core insight — give an AI agent a real experiment setup, let it modify code, run a fixed-time experiment, check if the metric improved, keep or discard, and repeat — is his contribution to the field.

Key references:
- [autoresearch repository](https://github.com/karpathy/autoresearch) — The original implementation for LLM training optimization
- [Announcement tweet](https://x.com/karpathy/status/2029701092347630069) — Context on the project's goals
- [Follow-up tweet](https://x.com/karpathy/status/2031135152349524125) — Results and learnings

## Model Context Protocol

Built on the [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic, using the [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk).

## Community Inspirations

The composable technique catalog draws from research and patterns across:
- **AlphaEvolve** (Google DeepMind) — Evolutionary search strategies
- **DSPy** (Stanford NLP) — Prompt optimization frameworks
- **Optuna** — Bayesian optimization for hyperparameter tuning
- **Nightcrawler** — Bounded episode execution patterns
- **LMSYS/MT-Bench** — LLM-as-judge evaluation methodology
- **Madaan et al. 2023** — Self-refine pattern
