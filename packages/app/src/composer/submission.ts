import type { ComposerCommand } from "../open-code-view";
import type { PromptCommand } from "./types";

export function hasSubmittablePrompt(text: string, fileCount: number): boolean {
  return text.trim().length > 0 || fileCount > 0;
}

export function ownsThreadComposerQueue(parentSessionId: string | null): boolean {
  return parentSessionId === null;
}

export function shouldQueueThreadPrompt(input: {
  readonly ownsQueue: boolean;
  readonly sendNow: boolean;
}): boolean {
  return input.ownsQueue && !input.sendNow;
}

export function classifyPromptCommand(input: {
  readonly text: string;
  readonly fileCount: number;
  readonly localCommands: readonly Pick<ComposerCommand, "name">[];
  readonly serverCommands: readonly Pick<ComposerCommand, "name">[];
}): PromptCommand | null {
  if (input.fileCount > 0) {
    return null;
  }
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(input.text.trim());
  if (match === null) {
    return null;
  }
  const name = match[1] ?? "";
  const known = [...input.localCommands, ...input.serverCommands].some(
    (command) => command.name === name,
  );
  return known ? { name, arguments: (match[2] ?? "").trim() } : null;
}

export function expandPromptCommandTemplate(template: string, args: string): string {
  const values = args.match(/(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi) ?? [];
  const positions = [...template.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
  const last = Math.max(0, ...positions);
  const expanded = template.replaceAll("$ARGUMENTS", args).replace(/\$(\d+)/g, (_, raw: string) => {
    const position = Number(raw);
    const selected =
      position === last ? values.slice(position - 1).join(" ") : (values[position - 1] ?? "");
    return selected.replace(/^['"]|['"]$/g, "");
  });
  // A template that never references its arguments would otherwise drop whatever the user typed
  // after the command. Append it so the command body can never overwrite their message.
  if (template.includes("$ARGUMENTS") || positions.length > 0 || args.length === 0) return expanded;
  return `${expanded}\n\n${args}`;
}

// Skills are sent as a compact `[name][path]` pointer (rendered as a chip) rather than by expanding
// the SKILL.md body, so the user's message survives and the raw markdown never shows in the UI.
// The path always contains a slash, which keeps this from matching markdown reference links.
const SKILL_REFERENCE_PATTERN = /\[([^[\]]+)\]\[([^[\]]*\/[^[\]]*)\]/g;

export function formatSkillReference(name: string, path: string): string {
  return `[${name}][${path}]`;
}

export type SkillReferenceSegment =
  | { readonly type: "text"; readonly value: string; readonly offset: number }
  | {
      readonly type: "skill";
      readonly name: string;
      readonly path: string;
      readonly offset: number;
    };

export function splitSkillReferences(text: string): readonly SkillReferenceSegment[] {
  const segments: SkillReferenceSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(SKILL_REFERENCE_PATTERN)) {
    const start = match.index;
    if (start > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, start), offset: cursor });
    }
    segments.push({
      type: "skill",
      name: match[1] ?? "",
      path: match[2] ?? "",
      offset: start,
    });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor), offset: cursor });
  }
  return segments;
}

export function formatSkillReferenceLabel(text: string): string {
  return splitSkillReferences(text)
    .map((segment) => (segment.type === "text" ? segment.value : `/${segment.name}`))
    .join("");
}

export function waitForPendingReads(
  pending: readonly Promise<unknown>[],
  onSettled: () => void,
): boolean {
  if (pending.length === 0) {
    return false;
  }
  void Promise.allSettled(pending).then(() => {
    onSettled();
  });
  return true;
}

const INLINE_CONTEXT_DATA_PREFIX = "data:text/plain;honk-context=";

export type InlineContextKind = "branch" | "chat";

export function formatInlineContextDataUrl(kind: InlineContextKind, content: string): string {
  return `${INLINE_CONTEXT_DATA_PREFIX}${kind};charset=utf-8,${encodeURIComponent(content)}`;
}

export function inlineContextKindFromDataUrl(url: string): InlineContextKind | null {
  if (url.startsWith(`${INLINE_CONTEXT_DATA_PREFIX}branch;`)) return "branch";
  if (url.startsWith(`${INLINE_CONTEXT_DATA_PREFIX}chat;`)) return "chat";
  return null;
}
