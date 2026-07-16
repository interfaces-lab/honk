import type { Part } from "@honk/opencode";

export type ToolPart = Extract<Part, { readonly type: "tool" }>;
export type ToolTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type ToolTodo = {
  readonly id?: string;
  readonly content: string;
  readonly activeForm?: string;
  readonly status: ToolTodoStatus;
};

export function toolMetadata(part: ToolPart): Record<string, unknown> {
  const stateMetadata =
    part.state.status === "running" ||
    part.state.status === "completed" ||
    part.state.status === "error"
      ? part.state.metadata
      : undefined;
  return { ...(part.metadata ?? {}), ...(stateMetadata ?? {}) };
}

export function isTodoTool(tool: string): boolean {
  return tool === "todowrite" || tool === "todoread";
}

export function toolTodos(part: ToolPart): readonly ToolTodo[] | undefined {
  if (!isTodoTool(part.tool)) return undefined;

  const records =
    recordArray(toolMetadata(part), "todos") ??
    recordArray(toolMetadata(part), "newTodos") ??
    recordArray(part.state.input, "todos");
  if (records === undefined) return undefined;

  return records.flatMap((todo) => {
    const content = stringField(todo, "content");
    if (content === undefined) return [];

    const id = stringField(todo, "id");
    const activeForm = stringField(todo, "activeForm");
    return [
      {
        content,
        status: todoStatus(stringField(todo, "status")),
        ...(id === undefined ? {} : { id }),
        ...(activeForm === undefined ? {} : { activeForm }),
      },
    ];
  });
}

export function latestTodos(parts: readonly Part[]): readonly ToolTodo[] {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part?.type !== "tool" || !isTodoTool(part.tool)) continue;
    const todos = toolTodos(part);
    if (todos !== undefined) return todos;
  }
  return [];
}

function todoStatus(value: string | undefined): ToolTodoStatus {
  switch (value) {
    case "in_progress":
    case "completed":
    case "cancelled":
      return value;
    default:
      return "pending";
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function recordField(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  return record === undefined ? undefined : asRecord(record[key]);
}

export function stringField(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function numberField(
  record: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function booleanField(
  record: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
}

export function unknownArray(
  record: Record<string, unknown> | undefined,
  key: string,
): readonly unknown[] | undefined {
  const value = record?.[key];
  return Array.isArray(value) ? value : undefined;
}

export function recordArray(
  record: Record<string, unknown> | undefined,
  key: string,
): readonly Record<string, unknown>[] | undefined {
  const value = unknownArray(record, key);
  if (value === undefined) return undefined;
  return value.map(asRecord).filter((item): item is Record<string, unknown> => item !== undefined);
}
