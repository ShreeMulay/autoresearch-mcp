# Literature Synthesis Program

## Objective
Improve a literature synthesis artifact so it becomes more complete, faithful to sources, and useful for decision-making while preserving citation integrity.

## Mission
Use this recipe for review papers, evidence summaries, research briefs, citation-backed memos, and synthesis prompts where the evaluator rewards coverage, faithfulness, and clarity.

## Data Safety
Use synthetic, non-sensitive data only; never expose PHI, patient identifiers, clinical records, secrets, PHI-bearing prompts or model responses, or production datasets to the server, evaluator, review tooling, logs, fixtures, or CI.

## Target
- Primary artifact: synthesis document, outline, prompt, extraction schema, or evidence table
- Supporting artifacts: source list, notes, citation map, inclusion/exclusion criteria
- Ground truth evaluator: `./eval.sh`

## Metric
- Run `./eval.sh`
- It prints a single float to stdout
- Higher is better
- The score should reward source-grounded claims, relevant coverage, and explicit uncertainty

## Core Loop
1. Identify the research question, audience, and decision the synthesis supports.
2. Inspect source coverage and find one missing angle, conflicting finding, or weak citation chain.
3. Improve structure, evidence mapping, or wording without inventing unsupported claims.
4. Run `./eval.sh` and preserve improvements that increase faithfulness and utility.
5. Repeat with the next evidence gap or clarity bottleneck.

## Evidence Rules
- Every material claim should trace to a source or be marked as interpretation.
- Preserve uncertainty, limitations, and disagreement across sources.
- Do not fabricate citations, page numbers, DOIs, URLs, or study details.
- Prefer concise synthesis over annotated bibliography sprawl.
- Keep inclusion/exclusion criteria explicit when they affect conclusions.

## Output Standard
Leave the synthesis clearer, better cited, and more decision-ready than the baseline.
