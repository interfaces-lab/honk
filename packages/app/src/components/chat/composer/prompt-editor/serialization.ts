import type {
  ComposerCommandPayload,
  ComposerDocSegment,
  ComposerInlineTokenPayload,
  ComposerMentionPayload,
  ComposerSkillPayload,
} from "./types";

export function mentionText(payload: Pick<ComposerMentionPayload, "path">): string {
  return payload.path ? `@${payload.path}` : "@";
}

export function commandText(payload: Pick<ComposerCommandPayload, "name">): string {
  return payload.name ? `/${payload.name}` : "/";
}

export function skillText(payload: Pick<ComposerSkillPayload, "name" | "path">): string {
  if (!payload.name) return "$";
  return payload.path ? `[$${payload.name}](${payload.path})` : `$${payload.name}`;
}

export function inlineTokenText(payload: Pick<ComposerInlineTokenPayload, "markdown">): string {
  return payload.markdown;
}

export function composerSegmentExpandedText(segment: ComposerDocSegment): string {
  switch (segment.type) {
    case "text":
      return segment.text;
    case "linebreak":
      return "\n";
    case "mention":
      return mentionText(segment.payload);
    case "command":
      return commandText(segment.payload);
    case "skill":
      return skillText(segment.payload);
    case "inline-token":
      return inlineTokenText(segment.payload);
  }
}

export function composerSegmentCollapsedLength(segment: ComposerDocSegment): number {
  return segment.type === "text" ? segment.text.length : 1;
}

export function composerSegmentExpandedLength(segment: ComposerDocSegment): number {
  return composerSegmentExpandedText(segment).length;
}

export function composerSegmentsExpandedText(segments: ReadonlyArray<ComposerDocSegment>): string {
  return segments.map(composerSegmentExpandedText).join("");
}
