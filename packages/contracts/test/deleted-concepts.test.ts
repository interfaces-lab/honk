import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const scanRoots = [
  "packages/contracts/src",
  "packages/server/src",
  "packages/server/test",
  "packages/app/src",
] as const;
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);

const forbiddenTerms: ReadonlyArray<{ readonly label: string; readonly terms: readonly string[] }> =
  [
    {
      label: "checkpoint implementation",
      terms: ["checkpoint", "Checkpoint"],
    },
    {
      label: "thread revert events",
      terms: ["thread.reverted", "ThreadReverted", "thread-reverted"],
    },
    {
      label: "durable assistant delta events",
      terms: ["thread.message.assistant.delta", "ThreadMessageAssistantDelta"],
    },
    {
      label: "removed OpenCode provider",
      terms: ["opencode", "OpenCode"],
    },
    {
      label: "standalone Cursor SDK provider",
      terms: ["cursorSdk", "CursorSdk", "CursorSDK"],
    },
    {
      label: "dead active entry columns",
      terms: ["activeEntryId", "active_entry_id"],
    },
    {
      label: "legacy timeline derivation",
      terms: ["deriveTimelineEntries"],
    },
    {
      label: "private subagent preview adapters",
      terms: ["subagent-preview", "SubagentPreview", "subagentPreview"],
    },
    {
      label: "removed timeline row variants",
      terms: ["OrchestrationChatTimelineToolSummaryRow", "OrchestrationChatTimelineGlobalStatusRow"],
    },
  ];

function listSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "_generated") {
        continue;
      }
      files.push(...listSourceFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }
  return files;
}

describe("deleted concept inventory", () => {
  it("keeps removed implementation identifiers out of source and server tests", () => {
    const violations: string[] = [];
    const files = scanRoots.flatMap((scanRoot) => listSourceFiles(path.join(repoRoot, scanRoot)));

    for (const file of files) {
      const contents = fs.readFileSync(file, "utf8");
      for (const forbidden of forbiddenTerms) {
        for (const term of forbidden.terms) {
          if (contents.includes(term)) {
            violations.push(
              `${path.relative(repoRoot, file)} contains ${JSON.stringify(term)} (${forbidden.label})`,
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
