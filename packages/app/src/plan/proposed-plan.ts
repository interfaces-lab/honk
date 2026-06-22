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

export interface PlanMarkdownTodo {
  readonly lineIndex: number;
  readonly content: string;
  readonly completed: boolean;
}

const PLAN_MARKDOWN_TODO_PATTERN = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$/;

function normalizeTodoContent(content: string): string {
  return content
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function parsePlanMarkdownTodos(planMarkdown: string): PlanMarkdownTodo[] {
  return planMarkdown.split(/\r?\n/).flatMap((line, lineIndex) => {
    const match = line.match(PLAN_MARKDOWN_TODO_PATTERN);
    if (!match) {
      return [];
    }
    const content = match[4]?.trim() ?? "";
    if (content.length === 0) {
      return [];
    }
    return [
      {
        lineIndex,
        content,
        completed: match[2]?.toLowerCase() === "x",
      },
    ];
  });
}

export function arePlanMarkdownTodosComplete(planMarkdown: string): boolean {
  const todos = parsePlanMarkdownTodos(planMarkdown);
  return todos.length > 0 && todos.every((todo) => todo.completed);
}

export function planMarkdownHasTodos(planMarkdown: string): boolean {
  return parsePlanMarkdownTodos(planMarkdown).length > 0;
}

export function syncPlanMarkdownTodosWithSteps(
  planMarkdown: string,
  steps: ReadonlyArray<{
    readonly step: string;
    readonly status: "pending" | "inProgress" | "completed";
  }>,
): string {
  if (steps.length === 0) {
    return planMarkdown;
  }

  const statusByContent = new Map<string, "pending" | "inProgress" | "completed">();
  for (const step of steps) {
    const key = normalizeTodoContent(step.step);
    if (key.length > 0) {
      statusByContent.set(key, step.status);
    }
  }
  if (statusByContent.size === 0) {
    return planMarkdown;
  }

  let changed = false;
  const lines = planMarkdown.split(/\r?\n/).map((line) => {
    const match = line.match(PLAN_MARKDOWN_TODO_PATTERN);
    if (!match) {
      return line;
    }
    const content = normalizeTodoContent(match[4] ?? "");
    const status = statusByContent.get(content);
    if (!status) {
      return line;
    }
    const nextMarker = status === "completed" ? "x" : " ";
    if (match[2] === nextMarker) {
      return line;
    }
    changed = true;
    return `${match[1]}${nextMarker}${match[3]}${match[4] ?? ""}`;
  });

  return changed ? lines.join("\n") : planMarkdown;
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
