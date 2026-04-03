#!/usr/bin/env bun
/**
 * Self-optimization evaluator for autoresearch-mcp tool descriptions.
 *
 * Tests whether the tool descriptions lead to correct tool selection.
 * Given 30 natural-language queries, scores how many map to the correct tool
 * based on keyword and intent matching against the descriptions.
 *
 * Contract: prints a single float (0-100) to stdout.
 */

import { resolve } from "node:path"

const SCRIPT_DIR = resolve(import.meta.dir)

// The 30 test queries with expected correct tool
const TEST_QUERIES: Array<{ query: string; expected_tool: string; key_signals: string[] }> = [
  // search_techniques (6 queries)
  { query: "What techniques are available for prompt optimization?", expected_tool: "search_techniques", key_signals: ["search", "technique", "query", "list"] },
  { query: "Find autoresearch methods for code performance", expected_tool: "search_techniques", key_signals: ["search", "technique", "query"] },
  { query: "List all evaluator types", expected_tool: "search_techniques", key_signals: ["list", "technique", "query", "empty"] },
  { query: "Are there any techniques for ML training?", expected_tool: "search_techniques", key_signals: ["search", "technique"] },
  { query: "Show me everything in the catalog", expected_tool: "search_techniques", key_signals: ["list", "all", "technique", "empty"] },
  { query: "Search for bayesian optimization", expected_tool: "search_techniques", key_signals: ["search", "technique", "query"] },

  // get_technique (4 queries)
  { query: "Tell me everything about hill-climbing", expected_tool: "get_technique", key_signals: ["detail", "specific", "ID", "technique"] },
  { query: "What is the single-ratchet pattern?", expected_tool: "get_technique", key_signals: ["detail", "specific", "ID"] },
  { query: "Show me the full description of prompt-optimization recipe", expected_tool: "get_technique", key_signals: ["detail", "full", "specific", "ID"] },
  { query: "Explain how the two-loop execution pattern works", expected_tool: "get_technique", key_signals: ["detail", "specific", "ID", "pattern"] },

  // suggest_technique (4 queries)
  { query: "I need to improve my chatbot's response quality, what should I use?", expected_tool: "suggest_technique", key_signals: ["problem", "recommend", "suggest", "optimization"] },
  { query: "Which technique fits a config tuning task with Lighthouse scores?", expected_tool: "suggest_technique", key_signals: ["problem", "recommend", "suggest", "which"] },
  { query: "I want to optimize test coverage overnight, what approach?", expected_tool: "suggest_technique", key_signals: ["problem", "recommend", "suggest", "optimization"] },
  { query: "Recommend the best strategy for improving our API docs", expected_tool: "suggest_technique", key_signals: ["recommend", "problem", "suggest"] },

  // register_experiment (3 queries)
  { query: "Create a new experiment tracking entry for my prompt project", expected_tool: "register_experiment", key_signals: ["register", "new", "experiment", "track"] },
  { query: "Start tracking an experiment with eval_score as the metric", expected_tool: "register_experiment", key_signals: ["register", "new", "experiment", "track", "metric"] },
  { query: "Set up experiment tracking for code optimization in my repo", expected_tool: "register_experiment", key_signals: ["register", "experiment", "track"] },

  // log_result (3 queries)
  { query: "Record that iteration 5 scored 87.3 and was an improvement", expected_tool: "log_result", key_signals: ["log", "result", "iteration", "score"] },
  { query: "Log this experiment run: score 92, iteration 3, change was adding examples", expected_tool: "log_result", key_signals: ["log", "result", "iteration", "score"] },
  { query: "Save the latest iteration result", expected_tool: "log_result", key_signals: ["log", "result", "iteration"] },

  // get_experiment (2 queries)
  { query: "Show me the results for experiment abc-123", expected_tool: "get_experiment", key_signals: ["get", "experiment", "detail", "result"] },
  { query: "What's the current status of my running experiment?", expected_tool: "get_experiment", key_signals: ["get", "experiment", "status", "detail"] },

  // scaffold_experiment (3 queries)
  { query: "Generate the autoresearch files for a prompt optimization project", expected_tool: "scaffold_experiment", key_signals: ["scaffold", "create", "file", "recipe", "generate"] },
  { query: "Set up the program.md and eval.sh for code-performance in my repo", expected_tool: "scaffold_experiment", key_signals: ["scaffold", "create", "file", "recipe"] },
  { query: "Bootstrap an experiment from the general-ratchet recipe", expected_tool: "scaffold_experiment", key_signals: ["scaffold", "create", "recipe", "file"] },

  // get_template (2 queries)
  { query: "Show me the program.md template for config-tuning", expected_tool: "get_template", key_signals: ["template", "file", "recipe"] },
  { query: "Get the eval.sh template for content-revision", expected_tool: "get_template", key_signals: ["template", "file", "recipe"] },

  // log_technique_outcome (2 queries)
  { query: "Record that prompt-optimization worked great for our chatbot project", expected_tool: "log_technique_outcome", key_signals: ["outcome", "technique", "domain", "worked", "success"] },
  { query: "Log that bayesian optimization partially worked for config tuning", expected_tool: "log_technique_outcome", key_signals: ["outcome", "technique", "domain", "log"] },

  // update_experiment (1 query)
  { query: "Mark experiment xyz as completed", expected_tool: "update_experiment", key_signals: ["update", "status", "experiment"] },
]

/**
 * Load current tool descriptions from the server.
 * We read the tool registration source files to extract descriptions.
 */
async function loadToolDescriptions(): Promise<Record<string, string>> {
  // Parse the actual server output for tool descriptions
  const proc = Bun.spawn(["bun", "run", resolve(SCRIPT_DIR, "../../src/index.ts")], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })

  const initMsg = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n'
  proc.stdin.write(initMsg)
  proc.stdin.end()

  const output = await new Response(proc.stdout).text()
  proc.kill()

  const tools: Record<string, string> = {}
  for (const line of output.split("\n")) {
    try {
      const msg = JSON.parse(line)
      if (msg.result?.tools) {
        for (const tool of msg.result.tools) {
          tools[tool.name] = tool.description ?? ""
        }
      }
    } catch { /* skip non-JSON lines */ }
  }
  return tools
}

/**
 * Score tool descriptions by simulating tool selection.
 * For each test query, check which tool's description best matches the query intent.
 */
function scoreDescriptions(tools: Record<string, string>): number {
  let correct = 0

  for (const test of TEST_QUERIES) {
    const queryLower = test.query.toLowerCase()

    // Score each tool against this query
    let bestTool = ""
    let bestScore = -1

    for (const [toolName, description] of Object.entries(tools)) {
      const descLower = description.toLowerCase()
      let score = 0

      // 1. Direct keyword overlap between query and description
      const queryWords = queryLower.split(/\s+/).filter(w => w.length > 3)
      for (const word of queryWords) {
        if (descLower.includes(word)) score += 1
      }

      // 2. Key signal matching — does the description contain the signals
      //    that should differentiate this tool from others?
      for (const signal of test.key_signals) {
        if (descLower.includes(signal.toLowerCase())) score += 2
      }

      // 3. Tool name in query bonus
      if (queryLower.includes(toolName.replace(/_/g, " "))) score += 3
      if (queryLower.includes(toolName.replace(/_/g, "-"))) score += 3

      if (score > bestScore) {
        bestScore = score
        bestTool = toolName
      }
    }

    if (bestTool === test.expected_tool) {
      correct++
    }
  }

  return (correct / TEST_QUERIES.length) * 100
}

async function main() {
  try {
    const tools = await loadToolDescriptions()
    if (Object.keys(tools).length === 0) {
      console.error("Failed to load tool descriptions")
      console.log("0.00")
      process.exit(1)
    }
    const score = scoreDescriptions(tools)
    console.log(score.toFixed(2))
  } catch (err) {
    console.error("Eval error:", err)
    console.log("0.00")
    process.exit(1)
  }
}

main()
