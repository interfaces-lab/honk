// Honk's local MCP server, declared in the overlay config's `mcp` block. It carries the
// recorded-result tools (plan_submit, debug_submit) to every provider arm: native providers
// through opencode's MCP client, the claude-code arm through the CLI's own --mcp-config bridge.
// OpenCode joins the names as honk_plan_submit / honk_debug_submit; the Claude CLI shows
// mcp__honk__plan_submit.
//
// Dependency-free plain JS so it runs under the opencode binary's embedded Bun (BUN_BE_BUN=1)
// or plain Node. Fully stateless and cwd-independent: the Claude CLI may spawn a second copy,
// and the app recovers the structured payload from the recorded tool-call input, not the result.

const PROTOCOL_VERSION = "2025-06-18";

const TOOLS = [
  {
    name: "plan_submit",
    description:
      "Records the finished implementation plan. Call this exactly once, after investigation, with the complete plan.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title for the plan." },
        summary: {
          type: "string",
          description: "One or two sentence summary of the intended outcome.",
        },
        steps: {
          type: "array",
          description: "Ordered implementation steps.",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short step title." },
              detail: {
                type: "string",
                description: "Optional detail: files/functions to change and how.",
              },
            },
            required: ["title"],
          },
        },
        files: {
          type: "array",
          description: "Repo-relative paths the plan touches (may be empty).",
          items: { type: "string" },
        },
      },
      required: ["title", "summary", "steps", "files"],
    },
  },
  {
    name: "debug_submit",
    description:
      "Records the completed diagnosis and the proposed fix. Call this exactly once after reproducing or tracing the issue, before your concise closing response.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title for the diagnosis." },
        summary: { type: "string", description: "Concise description of the observed failure." },
        rootCause: {
          type: "string",
          description: "Verified root cause, with the relevant code path.",
        },
        recommendedFix: {
          type: "string",
          description: "Smallest safe fix. Do not apply it in Debug mode.",
        },
        reproduction: {
          type: "string",
          description:
            "How the issue was reproduced or observed. Use an empty string when unavailable.",
        },
        files: {
          type: "array",
          description: "Repo-relative files implicated by the diagnosis (may be empty).",
          items: { type: "string" },
        },
        verification: {
          type: "array",
          description: "Checks that would establish the fix (may be empty).",
          items: { type: "string" },
        },
      },
      required: [
        "title",
        "summary",
        "rootCause",
        "recommendedFix",
        "reproduction",
        "files",
        "verification",
      ],
    },
  },
];

const TOOL_OUTPUT = {
  plan_submit: "Plan recorded.",
  debug_submit: "Diagnosis recorded.",
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function handle(message) {
  // Notifications carry no id and never get a response.
  if (message.id === undefined || message.id === null) return;

  if (message.method === "initialize") {
    const requested = message.params?.protocolVersion;
    respond(message.id, {
      protocolVersion: typeof requested === "string" ? requested : PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "honk", version: "1.0.0" },
    });
    return;
  }

  if (message.method === "ping") {
    respond(message.id, {});
    return;
  }

  if (message.method === "tools/list") {
    respond(message.id, { tools: TOOLS });
    return;
  }

  if (message.method === "tools/call") {
    const name = message.params?.name;
    const output = typeof name === "string" ? TOOL_OUTPUT[name] : undefined;
    if (output === undefined) {
      fail(message.id, -32602, `Unknown tool: ${String(name)}`);
      return;
    }
    respond(message.id, { content: [{ type: "text", text: output }] });
    return;
  }

  fail(message.id, -32601, `Unknown method: ${String(message.method)}`);
}

function parse(line) {
  if (line.trim().length === 0) return undefined;
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

let buffered = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffered += chunk;
  const lines = buffered.split("\n");
  buffered = lines.pop() ?? "";
  for (const message of lines.map(parse)) {
    if (message !== undefined) handle(message);
  }
});
process.stdin.on("end", () => {
  process.exit(0);
});
