# Literature Synthesis Program

## Objective
Improve a literature synthesis artifact while preserving citation integrity. The bundled evaluator is only a citation-density smoke heuristic; it does not establish semantic faithfulness or source validity.

## Mission
Use this recipe for review papers, evidence summaries, research briefs, citation-backed memos, and synthesis prompts where the evaluator rewards coverage, faithfulness, and clarity.

## Data Safety
Use synthetic, non-sensitive data only; never expose PHI, patient identifiers, clinical records, secrets, PHI-bearing prompts or model responses, or production datasets to the server, evaluator, review tooling, logs, fixtures, or CI.

## Target
- Primary artifact: synthesis document, outline, prompt, extraction schema, or evidence table
- Supporting artifacts: source list, notes, citation map, inclusion/exclusion criteria
- Citation-density smoke heuristic: `autoresearch/eval.sh` from the project root

## Metric
- Run `autoresearch/eval.sh` from the project root
- It prints a single float to stdout
- Follow the scaffolded metric direction and require strict improvement
- The score should reward source-grounded claims, relevant coverage, and explicit uncertainty

## Core Loop
1. Identify the research question, audience, and decision the synthesis supports.
2. Inspect source coverage and find one missing angle, conflicting finding, or weak citation chain.
3. Improve structure, evidence mapping, or wording without inventing unsupported claims.
4. Run `autoresearch/eval.sh` from the project root and use its citation-density result only as a smoke heuristic.
5. Repeat with the next evidence gap or clarity bottleneck.

## Evidence Rules
- Every material claim should trace to a source or be marked as interpretation.
- Preserve uncertainty, limitations, and disagreement across sources.
- Do not fabricate citations, page numbers, DOIs, URLs, or study details.
- Prefer concise synthesis over annotated bibliography sprawl.
- Keep inclusion/exclusion criteria explicit when they affect conclusions.

## Output Standard
Leave the synthesis clearer, better cited, and more decision-ready than the baseline.
