#!/usr/bin/env bun
/**
 * Self-optimization evaluator for suggest_technique quality.
 *
 * Tests whether suggest_technique returns relevant recommendations
 * for 15 diverse optimization problems.
 *
 * Contract: prints a single float (0-100) to stdout.
 */

import { resolve } from "node:path"

const TEST_PROBLEMS: Array<{
  problem: string
  expected_recipe: string
  acceptable_recipes: string[]
}> = [
  {
    problem: "I want to improve my chatbot system prompt accuracy",
    expected_recipe: "prompt-optimization",
    acceptable_recipes: ["prompt-optimization", "content-revision"],
  },
  {
    problem: "Optimize my test suite to run faster",
    expected_recipe: "code-performance",
    acceptable_recipes: ["code-performance", "test-amplification"],
  },
  {
    problem: "Tune my database connection pool settings for throughput",
    expected_recipe: "config-tuning",
    acceptable_recipes: ["config-tuning", "general-ratchet"],
  },
  {
    problem: "Improve the quality of our knowledge base articles",
    expected_recipe: "content-revision",
    acceptable_recipes: ["content-revision", "prompt-optimization"],
  },
  {
    problem: "Generate better unit tests for our API layer",
    expected_recipe: "test-amplification",
    acceptable_recipes: ["test-amplification", "code-performance"],
  },
  {
    problem: "Optimize my GPT training code for lower validation loss",
    expected_recipe: "ml-training",
    acceptable_recipes: ["ml-training", "code-performance", "general-ratchet"],
  },
  {
    problem: "Research and synthesize papers on transformer architectures",
    expected_recipe: "literature-synthesis",
    acceptable_recipes: ["literature-synthesis", "content-revision"],
  },
  {
    problem: "I have a script that returns a score and I want to maximize it",
    expected_recipe: "general-ratchet",
    acceptable_recipes: ["general-ratchet", "code-performance"],
  },
  {
    problem: "Optimize webpack config for smaller bundle size",
    expected_recipe: "config-tuning",
    acceptable_recipes: ["config-tuning", "code-performance"],
  },
  {
    problem: "Improve our medical Q&A prompt against clinical eval set",
    expected_recipe: "prompt-optimization",
    acceptable_recipes: ["prompt-optimization"],
  },
  {
    problem: "Make our Lighthouse performance score hit 95+",
    expected_recipe: "code-performance",
    acceptable_recipes: ["code-performance", "config-tuning"],
  },
  {
    problem: "Iterate on our data pipeline ETL for throughput",
    expected_recipe: "code-performance",
    acceptable_recipes: ["code-performance", "config-tuning", "general-ratchet"],
  },
  {
    problem: "Find the best hyperparameters for my random forest model",
    expected_recipe: "config-tuning",
    acceptable_recipes: ["config-tuning", "ml-training"],
  },
  {
    problem: "Optimize our marketing copy conversion rate",
    expected_recipe: "content-revision",
    acceptable_recipes: ["content-revision", "prompt-optimization"],
  },
  {
    problem: "Improve our API response formatting prompt",
    expected_recipe: "prompt-optimization",
    acceptable_recipes: ["prompt-optimization", "content-revision"],
  },
]

async function main() {
  try {
    // Call suggest_technique for each problem and check if the recommendation is relevant
    const proc = Bun.spawn(["bun", "run", resolve(import.meta.dir, "../../src/index.ts")], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })

    // Build JSON-RPC messages
    let messages = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n'

    for (let i = 0; i < TEST_PROBLEMS.length; i++) {
      const problem = TEST_PROBLEMS[i]
      messages += JSON.stringify({
        jsonrpc: "2.0",
        id: i + 10,
        method: "tools/call",
        params: {
          name: "suggest_technique",
          arguments: { problem: problem.problem },
        },
      }) + "\n"
    }

    proc.stdin.write(messages)
    proc.stdin.end()

    const output = await new Response(proc.stdout).text()
    proc.kill()

    // Parse responses and check if recommendations match
    let correct = 0
    let total = 0

    for (const line of output.split("\n")) {
      try {
        const msg = JSON.parse(line)
        if (msg.id && msg.id >= 10 && msg.result?.content) {
          const idx = msg.id - 10
          if (idx < TEST_PROBLEMS.length) {
            const text = msg.result.content[0]?.text ?? ""
            const problem = TEST_PROBLEMS[idx]
            total++

            // Check if any acceptable recipe appears in the recommendation
            const textLower = text.toLowerCase()
            const found = problem.acceptable_recipes.some(
              (r) => textLower.includes(r)
            )
            if (found) correct++
          }
        }
      } catch { /* skip */ }
    }

    const score = total > 0 ? (correct / total) * 100 : 0
    console.log(score.toFixed(2))
  } catch (err) {
    console.error("Eval error:", err)
    console.log("0.00")
    process.exit(1)
  }
}

main()
