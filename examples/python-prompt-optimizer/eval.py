#!/usr/bin/env python3
"""
Evaluator for the Python prompt optimizer.

Scores the prompt by simulating LLM responses using keyword matching
against an eval set of 10 Python questions.

In a real setup, this would call an actual LLM API. For this demo,
it uses a deterministic scoring rubric that rewards prompts which
produce better-structured, more complete answers.

Scoring rubric (per question, 0-10):
  - Keyword coverage: up to 4 points (expected keywords found in simulated response)
  - Code block expected: 2 points if prompt instructs code examples & question expects code
  - Structure signals: up to 4 points for prompt quality indicators
    - Has "step by step" or structured thinking instruction: +1
    - Has code formatting instruction: +1
    - Has conciseness instruction: +1
    - Has error handling / edge case instruction: +1

Final score = average across all questions, scaled to 0-100.

Contract: prints a single float to stdout.
"""

import json
import sys
import os
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROMPT_FILE = os.path.join(SCRIPT_DIR, "prompt.txt")
EVAL_SET_FILE = os.path.join(SCRIPT_DIR, "eval_set.json")


def load_prompt() -> str:
    with open(PROMPT_FILE, "r") as f:
        return f.read().strip()


def load_eval_set() -> list:
    with open(EVAL_SET_FILE, "r") as f:
        return json.load(f)


def score_prompt(prompt: str, eval_set: list) -> float:
    prompt_lower = prompt.lower()
    total_score = 0.0

    for item in eval_set:
        question_score = 0.0

        # 1. Keyword coverage potential (0-4 points)
        # Score how well the prompt INSTRUCTS the model to cover relevant topics
        expected_keywords = item.get("expected_keywords", [])
        keyword_hits = 0
        # Check if prompt contains terms that would guide toward these keywords
        guidance_terms = {
            "code": [
                "code",
                "example",
                "snippet",
                "demonstrate",
                "implementation",
                "show",
            ],
            "explain": [
                "explain",
                "reasoning",
                "step",
                "why",
                "how",
                "describe",
                "walk through",
            ],
            "complete": [
                "complete",
                "thorough",
                "comprehensive",
                "cover",
                "include",
                "detail",
            ],
            "practical": [
                "practical",
                "real-world",
                "use case",
                "common",
                "best practice",
            ],
        }
        for category, terms in guidance_terms.items():
            if any(term in prompt_lower for term in terms):
                keyword_hits += 1
        question_score += min(keyword_hits, 4)

        # 2. Code block guidance (0-2 points)
        expects_code = item.get("expected_has_code", False)
        if expects_code:
            code_signals = [
                "code",
                "example",
                "```",
                "snippet",
                "demonstrate",
                "show me",
                "implementation",
            ]
            if any(signal in prompt_lower for signal in code_signals):
                question_score += 2
            else:
                question_score += 0.5  # Partial credit

        # 3. Structure and quality signals (0-4 points)
        structure_checks = [
            # Step-by-step reasoning
            any(
                phrase in prompt_lower
                for phrase in [
                    "step by step",
                    "step-by-step",
                    "reasoning",
                    "think through",
                    "walk through",
                    "break down",
                    "explain your",
                ]
            ),
            # Code formatting instruction
            any(
                phrase in prompt_lower
                for phrase in [
                    "format",
                    "markdown",
                    "code block",
                    "```",
                    "syntax",
                    "well-formatted",
                    "readable",
                    "properly formatted",
                ]
            ),
            # Conciseness
            any(
                phrase in prompt_lower
                for phrase in [
                    "concise",
                    "brief",
                    "succinct",
                    "to the point",
                    "clear",
                    "direct",
                    "no unnecessary",
                ]
            ),
            # Edge cases / completeness
            any(
                phrase in prompt_lower
                for phrase in [
                    "edge case",
                    "error",
                    "exception",
                    "caveat",
                    "gotcha",
                    "pitfall",
                    "common mistake",
                    "watch out",
                    "note that",
                    "important",
                    "best practice",
                ]
            ),
        ]
        question_score += sum(1 for check in structure_checks if check)

        total_score += question_score

    # Max possible: 10 questions * 10 points each = 100
    max_possible = len(eval_set) * 10.0
    final_score = (total_score / max_possible) * 100.0

    return round(final_score, 2)


def main():
    try:
        prompt = load_prompt()
        eval_set = load_eval_set()
        score = score_prompt(prompt, eval_set)
        # Contract: print a single float to stdout
        print(score)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        print("0.0")
        sys.exit(1)


if __name__ == "__main__":
    main()
