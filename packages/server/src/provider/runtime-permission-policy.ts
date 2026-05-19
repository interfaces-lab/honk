import type { CanonicalRequestType, RuntimeMode } from "@multi/contracts";
import type { PermissionRuleset } from "@opencode-ai/sdk/v2";

export type RuntimePermissionAction =
  | "read"
  | "env_read"
  | "edit"
  | "command"
  | "external"
  | "unknown"
  | "user_input";

const READ_PERMISSION_KEYS = new Set([
  "read",
  "grep",
  "glob",
  "list",
  "lsp",
  "codesearch",
  "repo_overview",
  "webfetch",
  "websearch",
]);

const EDIT_PERMISSION_KEYS = new Set(["edit", "write", "patch", "apply_patch", "delete", "move"]);

const COMMAND_PERMISSION_KEYS = new Set(["bash", "shell", "execute", "exec", "command"]);
const USER_INPUT_PERMISSION_KEYS = new Set(["question", "ask_user"]);
const ENV_EXAMPLE_BASENAMES = new Set([".env.example"]);

export function isEnvFileReference(value: unknown): boolean {
  if (typeof value === "string") {
    return value.split(/\s+/).some((part) => {
      const basename = part
        .split(/[\\/]/)
        .pop()
        ?.replace(/^['"`]+|['"`.,;:]+$/g, "");
      if (!basename || ENV_EXAMPLE_BASENAMES.has(basename)) {
        return false;
      }
      return basename === ".env" || basename.endsWith(".env") || basename.startsWith(".env.");
    });
  }

  if (Array.isArray(value)) {
    return value.some(isEnvFileReference);
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(isEnvFileReference);
  }

  return false;
}

export function actionFromPermissionKey(permission: string): RuntimePermissionAction {
  const normalized = permission.toLowerCase();
  if (normalized === "external_directory") {
    return "external";
  }
  if (READ_PERMISSION_KEYS.has(normalized)) {
    return "read";
  }
  if (EDIT_PERMISSION_KEYS.has(normalized)) {
    return "edit";
  }
  if (COMMAND_PERMISSION_KEYS.has(normalized)) {
    return "command";
  }
  if (USER_INPUT_PERMISSION_KEYS.has(normalized)) {
    return "user_input";
  }
  return "unknown";
}

export function actionFromCanonicalRequestType(
  requestType: CanonicalRequestType,
): RuntimePermissionAction {
  switch (requestType) {
    case "file_read_approval":
      return "read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "edit";
    case "command_execution_approval":
    case "exec_command_approval":
      return "command";
    case "tool_user_input":
      return "user_input";
    default:
      return "unknown";
  }
}

export function actionFromAcpPermissionKind(kind: string | "unknown"): RuntimePermissionAction {
  switch (kind) {
    case "read":
      return "read";
    case "edit":
    case "delete":
    case "move":
      return "edit";
    case "execute":
      return "command";
    default:
      return "unknown";
  }
}

export function shouldPromptForAction(
  runtimeMode: RuntimeMode,
  action: RuntimePermissionAction,
): boolean {
  if (runtimeMode === "full-access") {
    return false;
  }

  switch (action) {
    case "read":
    case "user_input":
      return false;
    case "env_read":
    case "edit":
    case "command":
    case "external":
    case "unknown":
      return true;
  }
}

const allow = (permission: string, pattern = "*") => ({
  permission,
  pattern,
  action: "allow" as const,
});
const ask = (permission: string, pattern = "*") => ({
  permission,
  pattern,
  action: "ask" as const,
});

export function buildOpenCodePermissionRuleset(runtimeMode: RuntimeMode): PermissionRuleset {
  if (runtimeMode === "full-access") {
    return [allow("*")];
  }

  return [
    ask("*"),
    allow("read"),
    ask("read", "*.env"),
    ask("read", "*.env.*"),
    allow("read", "*.env.example"),
    allow("grep"),
    allow("glob"),
    allow("list"),
    allow("lsp"),
    allow("codesearch"),
    allow("repo_overview"),
    allow("webfetch"),
    allow("websearch"),
    allow("question"),
    ask("bash"),
    ask("edit"),
    ask("external_directory"),
    ask("doom_loop"),
  ];
}
