import type { ToolDefinition, ToolResult } from "./types";

interface PlanStep {
  readonly title: string;
  readonly detail?: string;
}

interface RecordedPlan {
  readonly title: string;
  readonly summary: string;
  readonly steps: readonly PlanStep[];
  readonly files: readonly string[];
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeSteps(value: unknown): PlanStep[] {
  if (!Array.isArray(value)) return [];

  const steps: PlanStep[] = [];
  for (const raw of value) {
    if (typeof raw === "string") {
      steps.push({ title: raw });
      continue;
    }

    const title = asString(field(raw, "title"));
    const detail = asString(field(raw, "detail"));
    if (title || detail) steps.push(detail ? { title, detail } : { title });
  }
  return steps;
}

function normalizeFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizePlan(args: unknown): RecordedPlan {
  return {
    title: asString(field(args, "title")),
    summary: asString(field(args, "summary")),
    steps: normalizeSteps(field(args, "steps")),
    files: normalizeFiles(field(args, "files")),
  };
}

export const planSubmitTool: ToolDefinition = {
  description:
    "Records the finished implementation plan. Call this exactly once, after investigation, with the complete plan.",
  args: {
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
  async execute(args): Promise<ToolResult> {
    const plan = normalizePlan(args);
    return {
      title: plan.title || "Plan",
      output: "Plan recorded.",
      metadata: { plan },
    };
  },
};
