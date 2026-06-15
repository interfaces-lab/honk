import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

export const DEBUG_LOGS_TOOL_NAME = "debug_logs";

const DEFAULT_DEBUG_LOG_LINE_COUNT = 100;
const MAX_DEBUG_LOG_LINE_COUNT = 2_000;

interface DebugLogsToolDetails {
  readonly action: "path" | "read" | "clear";
  readonly logFilePath: string;
  readonly lines: readonly string[];
  readonly totalCount: number;
  readonly cleared: boolean;
}

const DebugLogsAction = Type.Union(
  [Type.Literal("path"), Type.Literal("read"), Type.Literal("clear")],
  {
    description: "Debug log operation.",
  },
);

const DebugLogsParams = Type.Object({
  action: DebugLogsAction,
  lines: Type.Optional(
    Type.Number({
      description: "Maximum number of trailing log lines to return for read. Defaults to 100.",
    }),
  ),
});

function debugLogPath(agentDir: string, cwd: string): string {
  const cwdHash = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
  return join(agentDir, "honk-debug-logs", cwdHash, "debug.log");
}

function clampLineCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_DEBUG_LOG_LINE_COUNT;
  }
  return Math.max(1, Math.min(MAX_DEBUG_LOG_LINE_COUNT, Math.floor(value)));
}

function isFileNotFound(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) {
    return false;
  }
  return (error as { readonly code?: unknown }).code === "ENOENT";
}

async function ensureDebugLogFile(logFilePath: string): Promise<void> {
  await mkdir(dirname(logFilePath), { recursive: true });
  await writeFile(logFilePath, "", { flag: "a" });
}

async function readDebugLogTail(
  logFilePath: string,
  lineCount: number,
): Promise<{ readonly lines: readonly string[]; readonly totalCount: number }> {
  try {
    const content = await readFile(logFilePath, "utf8");
    const allLines = content.length === 0 ? [] : content.replace(/\n$/, "").split(/\r?\n/);
    return {
      lines: allLines.slice(-lineCount),
      totalCount: allLines.length,
    };
  } catch (error) {
    if (isFileNotFound(error)) {
      return { lines: [], totalCount: 0 };
    }
    throw error;
  }
}

function textResult(text: string, details: DebugLogsToolDetails) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

export function createDebugLogsExtension(options: { readonly agentDir: string }): ExtensionFactory {
  return (pi) => {
    pi.registerTool(
      defineTool({
        name: DEBUG_LOGS_TOOL_NAME,
        label: "Debug Logs",
        description:
          "Get the current debug log file path, read recent debug log lines, or clear the debug log before a fresh reproduction.",
        promptSnippet:
          "Use debug_logs to get, read, or clear the debug log file for runtime traces.",
        promptGuidelines: [
          "Use debug_logs with action:path before running instrumented or reproduction commands so their output can be appended to the returned log file.",
          "Use debug_logs with action:clear before a fresh reproduction when stale logs would confuse the diagnosis.",
          "Use debug_logs with action:read after reproduction commands to inspect the latest captured traces.",
        ],
        parameters: DebugLogsParams,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          const logFilePath = debugLogPath(options.agentDir, ctx.cwd);
          await ensureDebugLogFile(logFilePath);

          if (params.action === "clear") {
            await writeFile(logFilePath, "");
            return textResult(`Cleared debug log at ${logFilePath}.`, {
              action: "clear",
              logFilePath,
              lines: [],
              totalCount: 0,
              cleared: true,
            });
          }

          if (params.action === "path") {
            return textResult(`Debug log path: ${logFilePath}`, {
              action: "path",
              logFilePath,
              lines: [],
              totalCount: 0,
              cleared: false,
            });
          }

          const lineCount = clampLineCount(params.lines);
          const tail = await readDebugLogTail(logFilePath, lineCount);
          const summary =
            tail.lines.length === 0
              ? `Debug log is empty at ${logFilePath}.`
              : `Read ${tail.lines.length} of ${tail.totalCount} debug log lines from ${logFilePath}.`;
          return textResult(summary, {
            action: "read",
            logFilePath,
            lines: tail.lines,
            totalCount: tail.totalCount,
            cleared: false,
          });
        },
      }),
    );
  };
}
