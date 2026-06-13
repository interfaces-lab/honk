export function proposedPlanTitle(planMarkdown: string): string | null {
  const heading = planMarkdown.match(/^\s{0,3}#{1,6}\s+(.+)$/m)?.[1]?.trim();
  return heading && heading.length > 0 ? heading : null;
}

export function stripDisplayedPlanMarkdown(planMarkdown: string): string {
  const lines = planMarkdown.trimEnd().split(/\r?\n/);
  const sourceLines = lines[0] && /^\s{0,3}#{1,6}\s+/.test(lines[0]) ? lines.slice(1) : [...lines];
  while (sourceLines[0]?.trim().length === 0) {
    sourceLines.shift();
  }
  const firstHeadingMatch = sourceLines[0]?.match(/^\s{0,3}#{1,6}\s+(.+)$/);
  if (firstHeadingMatch?.[1]?.trim().toLowerCase() === "summary") {
    sourceLines.shift();
    while (sourceLines[0]?.trim().length === 0) {
      sourceLines.shift();
    }
  }
  return sourceLines.join("\n");
}

export function normalizePlanMarkdownForExport(planMarkdown: string): string {
  return `${planMarkdown.trim()}\n`;
}

export function ensurePlanMarkdownPath(relativePath: string): string {
  const trimmedPath = relativePath.trim();
  if (trimmedPath.length === 0 || /\.(?:md|markdown)$/i.test(trimmedPath)) {
    return trimmedPath;
  }
  return `${trimmedPath}.md`;
}

export function buildProposedPlanMarkdownFilename(planMarkdown: string): string {
  const title = proposedPlanTitle(planMarkdown) ?? "proposed-plan";
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return ensurePlanMarkdownPath(slug || "proposed-plan");
}

export function buildPlanImplementationPrompt(planMarkdown: string): string {
  return [
    "Implement the accepted plan below.",
    "",
    "Treat the plan as the source of truth for this implementation turn. Keep the work scoped to the plan, preserve intentional behavior, and verify the result. If the plan is blocked by missing information or a contradictory current state, report that clearly instead of inventing a different direction.",
    "",
    "Accepted plan:",
    "",
    planMarkdown.trim(),
  ].join("\n");
}

export function resolvePlanFollowUpSubmission(input: { draftText: string; planMarkdown: string }): {
  text: string;
  interactionMode: "agent" | "plan";
} {
  const trimmedDraftText = input.draftText.trim();
  if (trimmedDraftText.length > 0) {
    return {
      text: trimmedDraftText,
      interactionMode: "plan",
    };
  }

  return {
    text: buildPlanImplementationPrompt(input.planMarkdown),
    interactionMode: "agent",
  };
}
