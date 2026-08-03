import { basename } from "@honk/shared/paths";

import type { PromptComposerFile } from "../open-code-view";
import type { Attachment } from "./attachments";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePromptComposerFile(value: unknown): PromptComposerFile | null {
  if (!isRecord(value) || typeof value.path !== "string") return null;
  const context =
    isRecord(value.context) &&
    (value.context.kind === "branch" || value.context.kind === "chat") &&
    typeof value.context.sourceKey === "string"
      ? Object.freeze({ kind: value.context.kind, sourceKey: value.context.sourceKey })
      : undefined;
  const source =
    isRecord(value.source) &&
    typeof value.source.text === "string" &&
    typeof value.source.start === "number" &&
    Number.isInteger(value.source.start) &&
    value.source.start >= 0 &&
    typeof value.source.end === "number" &&
    Number.isInteger(value.source.end) &&
    value.source.end >= value.source.start
      ? Object.freeze({
          text: value.source.text,
          start: value.source.start,
          end: value.source.end,
        })
      : undefined;
  return Object.freeze({
    path: value.path,
    ...(typeof value.filename === "string" ? { filename: value.filename } : {}),
    ...(typeof value.mime === "string" ? { mime: value.mime } : {}),
    ...(source === undefined ? {} : { source }),
    ...(context === undefined ? {} : { context }),
  });
}

export function physicalAttachmentsFromPromptFiles(
  files: readonly PromptComposerFile[],
  keyPrefix: string,
  editorState?: string,
): readonly Attachment[] {
  const legacyMentionCounts = composerMentionPaths(editorState).reduce<Map<string, number>>(
    (counts, path) => counts.set(path, (counts.get(path) ?? 0) + 1),
    new Map(),
  );
  files
    .filter((file) => file.source !== undefined)
    .forEach((file) => {
      legacyMentionCounts.set(
        file.path,
        Math.max(0, (legacyMentionCounts.get(file.path) ?? 0) - 1),
      );
    });
  return files.flatMap((file, index) =>
    physicalAttachmentFromPromptFile(file, index, keyPrefix, legacyMentionCounts),
  );
}

function composerMentionPaths(editorState: string | undefined): readonly string[] {
  if (editorState === undefined) return [];
  try {
    return collectComposerMentionPaths(JSON.parse(editorState) as unknown);
  } catch {
    return [];
  }
}

function collectComposerMentionPaths(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap(collectComposerMentionPaths);
  if (!isRecord(value)) return [];
  return [
    ...(value.type === "composerMention" &&
    typeof value.path === "string" &&
    (value.kind === undefined || value.kind === "file")
      ? [value.path]
      : []),
    ...Object.values(value).flatMap(collectComposerMentionPaths),
  ];
}

function physicalAttachmentFromPromptFile(
  file: PromptComposerFile,
  index: number,
  keyPrefix: string,
  legacyMentionCounts: Map<string, number>,
): readonly Attachment[] {
  if (file.source !== undefined || file.context !== undefined) return [];
  const legacyMentionCount = legacyMentionCounts.get(file.path) ?? 0;
  if (legacyMentionCount > 0) {
    legacyMentionCounts.set(file.path, legacyMentionCount - 1);
    return [];
  }
  return [
    {
      key: `${keyPrefix}:${String(index)}:${file.filename ?? "attachment"}`,
      label: file.filename ?? (file.path.startsWith("data:") ? "attachment" : basename(file.path)),
      path: file.path,
      ...(file.mime === undefined ? {} : { mime: file.mime }),
    },
  ];
}
