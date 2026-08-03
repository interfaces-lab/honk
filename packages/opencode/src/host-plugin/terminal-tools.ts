// Background terminal tools. Honk's desktop main process owns the PTY; this file
// only speaks to the aux HTTP API it exposes. Shapes are inlined because the emitted
// plugin lives in a state directory where workspace imports cannot resolve.

import type { ToolContext, ToolDefinition, ToolResult } from "./types";

// The plugin runs in the sidecar's Node runtime, but this package compiles without
// @types/node. Declare only the slice the aux client reads.
declare const process: { readonly env: Readonly<Record<string, string | undefined>> };

interface TerminalSnapshot {
  readonly threadId: string;
  readonly terminalId: string;
  readonly cwd: string;
  readonly status: "starting" | "running" | "exited" | "error";
  readonly pid: number | null;
  readonly history: string;
  readonly exitCode: number | null;
  readonly exitSignal: number | null;
  readonly updatedAt: string;
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function auxPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  const baseUrl = process.env.HONK_AUX_URL?.trim();
  const token = process.env.HONK_AUX_TOKEN?.trim();
  if (!baseUrl || !token) {
    throw new Error("honk: background terminals are only available inside the Honk desktop app.");
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    // The aux server serializes the real cause; without it the agent only sees a status code.
    const detail = asString(field(field(payload, "error"), "message"));
    throw new Error(
      `honk: terminal request to ${path} failed (HTTP ${String(response.status)})${
        detail.length > 0 ? `: ${detail}` : "."
      }`,
    );
  }
  return field(payload, "snapshot");
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function requireSnapshot(value: unknown, label: string): TerminalSnapshot {
  if (value === null || value === undefined) {
    throw new Error(`honk: no background terminal for "${label}" in this thread.`);
  }
  const terminalId = asString(field(value, "terminalId"));
  const status = field(value, "status");
  if (
    terminalId.length === 0 ||
    (status !== "starting" && status !== "running" && status !== "exited" && status !== "error")
  ) {
    throw new Error(`honk: the desktop returned an unrecognized terminal snapshot for "${label}".`);
  }
  const history = field(value, "history");
  return {
    threadId: asString(field(value, "threadId")),
    terminalId,
    cwd: asString(field(value, "cwd")),
    status,
    pid: asNumberOrNull(field(value, "pid")),
    history: typeof history === "string" ? history : "",
    exitCode: asNumberOrNull(field(value, "exitCode")),
    exitSignal: asNumberOrNull(field(value, "exitSignal")),
    updatedAt: asString(field(value, "updatedAt")),
  };
}

function describe(snapshot: TerminalSnapshot): string {
  const exit =
    snapshot.exitCode === null
      ? ""
      : ` (exit code ${String(snapshot.exitCode)}${
          snapshot.exitSignal === null ? "" : `, signal ${String(snapshot.exitSignal)}`
        })`;
  return `terminal_id: ${snapshot.terminalId}\nstatus: ${snapshot.status}${exit}\ncwd: ${snapshot.cwd}`;
}

function outputSection(snapshot: TerminalSnapshot): string {
  return snapshot.history.length === 0
    ? "\n\n<output>(no output yet)</output>"
    : `\n\n<output>\n${snapshot.history}\n</output>`;
}

const runTool: ToolDefinition = {
  description:
    "Starts a long-running command as a persistent background job (dev server, watcher, tunnel). " +
    "The job opens as a normal terminal tab in the user's workbench and keeps running across your " +
    "turns. The user owns its lifetime: they can type into that tab, and closing it kills the job. " +
    "Use this instead of bash for anything that does not exit on its own; use bash for commands " +
    "that finish. Poll the job with terminal_status and end it with terminal_stop. Do not start a " +
    "second job for the same service; check terminal_status first.",
  args: {
    command: {
      type: "string",
      description: "Shell command line to run, exactly as the user would type it.",
    },
    cwd: {
      type: "string",
      description: "Absolute working directory. Pass an empty string to use the thread's default.",
    },
  },
  async execute(args: unknown, context: ToolContext): Promise<ToolResult> {
    const command = asString(field(args, "command"));
    if (command.length === 0) throw new Error("honk: terminal_run needs a command.");
    const cwd = asString(field(args, "cwd"));
    const snapshot = requireSnapshot(
      await auxPost("/terminal/run", {
        threadId: context.sessionID,
        command,
        ...(cwd.length > 0 ? { cwd } : {}),
      }),
      command,
    );
    return {
      title: command,
      output: `Started a background terminal the user can see and close.\n${describe(snapshot)}`,
      metadata: { terminalId: snapshot.terminalId, status: snapshot.status },
    };
  },
};

const statusTool: ToolDefinition = {
  description:
    "Reports whether a background terminal job is still running and returns the tail of its output. " +
    "Poll this after terminal_run to confirm a server came up or to read an error.",
  args: {
    terminal_id: { type: "string", description: "The terminal_id returned by terminal_run." },
  },
  async execute(args: unknown, context: ToolContext): Promise<ToolResult> {
    const terminalId = asString(field(args, "terminal_id"));
    if (terminalId.length === 0) throw new Error("honk: terminal_status needs a terminal_id.");
    const snapshot = requireSnapshot(
      await auxPost("/terminal/status", { threadId: context.sessionID, terminalId }),
      terminalId,
    );
    return {
      title: terminalId,
      output: `${describe(snapshot)}${outputSection(snapshot)}`,
      metadata: { terminalId, status: snapshot.status },
    };
  },
};

const stopTool: ToolDefinition = {
  description:
    "Kills a background terminal job. The user's tab stays open showing the final output. " +
    "Stop jobs you started once you no longer need them; leave jobs the user is using alone.",
  args: {
    terminal_id: { type: "string", description: "The terminal_id returned by terminal_run." },
  },
  async execute(args: unknown, context: ToolContext): Promise<ToolResult> {
    const terminalId = asString(field(args, "terminal_id"));
    if (terminalId.length === 0) throw new Error("honk: terminal_stop needs a terminal_id.");
    const snapshot = requireSnapshot(
      await auxPost("/terminal/stop", { threadId: context.sessionID, terminalId }),
      terminalId,
    );
    return {
      title: terminalId,
      output: `Stopped the background terminal.\n${describe(snapshot)}`,
      metadata: { terminalId, status: snapshot.status },
    };
  },
};

export const terminalTools: Readonly<Record<string, ToolDefinition>> = {
  terminal_run: runTool,
  terminal_status: statusTool,
  terminal_stop: stopTool,
};
