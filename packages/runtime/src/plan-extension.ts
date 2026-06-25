import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

export const CREATE_PLAN_TOOL_NAME = "create_plan";

type CreatePlanTodoStatus = "pending" | "in_progress" | "completed";

export interface CreatePlanTodoDetails {
  readonly id: string | null;
  readonly content: string;
  readonly status: CreatePlanTodoStatus;
}

export interface CreatePlanPhaseDetails {
  readonly name: string;
  readonly todos: readonly CreatePlanTodoDetails[];
}

export interface CreatePlanToolDetails {
  readonly name: string | null;
  readonly overview: string | null;
  readonly todos: readonly CreatePlanTodoDetails[];
  readonly plan: string;
  readonly isProject: boolean;
  readonly phases: readonly CreatePlanPhaseDetails[];
  readonly planMarkdown: string;
}

const CreatePlanTodoStatus = Type.Union(
  [Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")],
  {
    description: "Current status for this plan todo.",
  },
);

const CreatePlanTodo = Type.Object({
  id: Type.Optional(Type.String({ description: "Stable todo id when one is available." })),
  content: Type.Optional(Type.String({ description: "Concrete todo text." })),
  title: Type.Optional(Type.String({ description: "Todo title, used when content is absent." })),
  status: Type.Optional(CreatePlanTodoStatus),
});

const CreatePlanPhase = Type.Object({
  name: Type.String({ description: "Short phase title." }),
  todos: Type.Array(CreatePlanTodo, { description: "Todos in this phase." }),
});

const CreatePlanParams = Type.Object({
  name: Type.Optional(Type.String({ description: "Short human-readable plan name." })),
  overview: Type.Optional(Type.String({ description: "Brief summary of the plan." })),
  plan: Type.String({
    description:
      "Complete Markdown plan body. Include diagnosis, implementation steps, verification, risks, and non-goals where relevant.",
  }),
  todos: Type.Array(CreatePlanTodo, { description: "Actionable todo list for the plan." }),
  isProject: Type.Optional(
    Type.Boolean({ description: "True when this is a honk-phase project plan." }),
  ),
  is_project: Type.Optional(
    Type.Boolean({ description: "Alias for isProject when using snake_case payloads." }),
  ),
  phases: Type.Optional(Type.Array(CreatePlanPhase, { description: "Optional plan phases." })),
});

function trimmedString(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function requiredTrimmedString(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`create_plan requires non-empty ${fieldName}.`);
  }
  return trimmed;
}

function normalizeTodoStatus(status: string | undefined): CreatePlanTodoStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "in_progress":
      return "in_progress";
    default:
      return "pending";
  }
}

function normalizeTodos(
  todos: ReadonlyArray<{
    readonly id?: string | undefined;
    readonly content?: string | undefined;
    readonly title?: string | undefined;
    readonly status?: string | undefined;
  }>,
): CreatePlanTodoDetails[] {
  return todos.flatMap((todo) => {
    const content = trimmedString(todo.content) ?? trimmedString(todo.title);
    if (!content) {
      return [];
    }
    return [
      {
        id: trimmedString(todo.id),
        content,
        status: normalizeTodoStatus(todo.status),
      },
    ];
  });
}

function planMarkdownHasTaskList(planMarkdown: string): boolean {
  return /^\s*[-*+]\s+\[[ xX]\]\s+\S/m.test(planMarkdown);
}

function todoMarkdownLine(todo: CreatePlanTodoDetails): string {
  const marker = todo.status === "completed" ? "x" : " ";
  return `- [${marker}] ${todo.content}`;
}

function planMarkdownWithTodos(
  planMarkdown: string,
  todos: ReadonlyArray<CreatePlanTodoDetails>,
): string {
  if (todos.length === 0 || planMarkdownHasTaskList(planMarkdown)) {
    return planMarkdown;
  }

  return [planMarkdown.trimEnd(), "", "## Todos", ...todos.map(todoMarkdownLine)].join("\n");
}

function normalizePhases(
  phases:
    | ReadonlyArray<{
        readonly name: string;
        readonly todos: ReadonlyArray<{
          readonly id?: string | undefined;
          readonly content?: string | undefined;
          readonly title?: string | undefined;
          readonly status?: string | undefined;
        }>;
      }>
    | undefined,
): CreatePlanPhaseDetails[] {
  return (phases ?? []).flatMap((phase) => {
    const name = trimmedString(phase.name);
    if (!name) {
      return [];
    }
    return [
      {
        name,
        todos: normalizeTodos(phase.todos),
      },
    ];
  });
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

const PLAN_MARKDOWN_CONTAINER_KEYS = [
  "details",
  "result",
  "toolResult",
  "value",
  "data",
  "output",
  "args",
] as const;

function findCreatePlanMarkdown(
  value: unknown,
  depth: number,
  visited: WeakSet<object>,
): string | null {
  if (depth > 4) {
    return null;
  }
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  if (visited.has(record)) {
    return null;
  }
  visited.add(record);

  const direct = readNonEmptyString(record.planMarkdown) ?? readNonEmptyString(record.plan);
  if (direct) {
    return direct;
  }

  for (const key of PLAN_MARKDOWN_CONTAINER_KEYS) {
    const nested = record[key];
    if (nested === undefined || nested === value) {
      continue;
    }
    const markdown = findCreatePlanMarkdown(nested, depth + 1, visited);
    if (markdown) {
      return markdown;
    }
  }

  return null;
}

export function extractCreatePlanToolResultMarkdown(result: unknown): string | null {
  return findCreatePlanMarkdown(result, 0, new WeakSet());
}

export function extractCreatePlanToolEventMarkdown(event: unknown): string | null {
  const eventRecord = readRecord(event);
  if (!eventRecord) {
    return extractCreatePlanToolResultMarkdown(event);
  }

  return (
    extractCreatePlanToolResultMarkdown(eventRecord.result) ??
    extractCreatePlanToolResultMarkdown(eventRecord.toolResult) ??
    extractCreatePlanToolResultMarkdown(eventRecord.details) ??
    extractCreatePlanToolResultMarkdown(eventRecord.args) ??
    extractCreatePlanToolResultMarkdown(event)
  );
}

export const createPlanExtension: ExtensionFactory = (pi) => {
  pi.registerTool(
    defineTool({
      name: CREATE_PLAN_TOOL_NAME,
      label: "Create Plan",
      description:
        "Create a proposed implementation plan for Honk's plan review UI. This is the final action for plan mode.",
      promptSnippet: "Create a proposed implementation plan for review.",
      promptGuidelines: [
        "Use create_plan as the final action in plan mode once the plan is ready for review.",
        "When the user provides feedback in plan mode, refine the existing plan and call create_plan again with the updated complete plan.",
        "Before calling create_plan, inspect the relevant code and ask clarifying questions if requirements are ambiguous.",
        "Do not modify files, run mutating commands, create commits, or implement the plan before calling create_plan.",
        "Put the complete Markdown plan in the plan field; include concrete files, implementation steps, verification, risks, and non-goals.",
      ],
      parameters: CreatePlanParams,
      async execute(_toolCallId, params) {
        const rawPlanMarkdown = requiredTrimmedString(params.plan, "plan");
        const todos = normalizeTodos(params.todos);
        const planMarkdown = planMarkdownWithTodos(rawPlanMarkdown, todos);
        const details: CreatePlanToolDetails = {
          name: trimmedString(params.name),
          overview: trimmedString(params.overview),
          todos,
          plan: planMarkdown,
          isProject: params.isProject ?? params.is_project ?? false,
          phases: normalizePhases(params.phases),
          planMarkdown,
        };
        const label = details.name ? `: ${details.name}` : "";
        const todoSummary = details.todos.length === 1 ? "1 todo" : `${details.todos.length} todos`;
        return {
          content: [{ type: "text", text: `Created plan${label} (${todoSummary}).` }],
          details,
          terminate: true,
        };
      },
    }),
  );
};
