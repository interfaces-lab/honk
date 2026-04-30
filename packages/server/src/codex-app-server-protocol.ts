import { Effect, Schema } from "effect";

import type { ProviderRequestKind } from "@multi/contracts";

export class CodexAppServerProcessSpawnError extends Schema.TaggedErrorClass<CodexAppServerProcessSpawnError>()(
  "CodexAppServerProcessSpawnError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Codex app-server process ${this.operation} failed: ${this.detail}`;
  }
}

export class CodexAppServerVersionCheckError extends Schema.TaggedErrorClass<CodexAppServerVersionCheckError>()(
  "CodexAppServerVersionCheckError",
  {
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Codex CLI version check failed: ${this.detail}`;
  }
}

export class CodexAppServerJsonParseError extends Schema.TaggedErrorClass<CodexAppServerJsonParseError>()(
  "CodexAppServerJsonParseError",
  {
    line: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Codex app-server JSON parse failed: ${this.detail}`;
  }
}

export class CodexAppServerInvalidMessageError extends Schema.TaggedErrorClass<CodexAppServerInvalidMessageError>()(
  "CodexAppServerInvalidMessageError",
  {
    detail: Schema.String,
    rawMessage: Schema.optional(Schema.Unknown),
  },
) {
  override get message(): string {
    return `Codex app-server invalid JSON-RPC message: ${this.detail}`;
  }
}

export class CodexAppServerRequestTimeoutError extends Schema.TaggedErrorClass<CodexAppServerRequestTimeoutError>()(
  "CodexAppServerRequestTimeoutError",
  {
    method: Schema.String,
    timeoutMs: Schema.Number,
  },
) {
  override get message(): string {
    return `Timed out waiting for ${this.method}.`;
  }
}

export class CodexAppServerWriteError extends Schema.TaggedErrorClass<CodexAppServerWriteError>()(
  "CodexAppServerWriteError",
  {
    detail: Schema.String,
    rawMessage: Schema.optional(Schema.Unknown),
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export class CodexAppServerUnsupportedRequestError extends Schema.TaggedErrorClass<CodexAppServerUnsupportedRequestError>()(
  "CodexAppServerUnsupportedRequestError",
  {
    method: Schema.String,
    payload: Schema.optional(Schema.Unknown),
  },
) {
  override get message(): string {
    return `Unsupported server request: ${this.method}`;
  }
}

export class CodexAppServerMissingSessionError extends Schema.TaggedErrorClass<CodexAppServerMissingSessionError>()(
  "CodexAppServerMissingSessionError",
  {
    threadId: Schema.String,
  },
) {
  override get message(): string {
    return `Unknown session for thread: ${this.threadId}`;
  }
}

export class CodexAppServerSessionClosedError extends Schema.TaggedErrorClass<CodexAppServerSessionClosedError>()(
  "CodexAppServerSessionClosedError",
  {
    threadId: Schema.String,
  },
) {
  override get message(): string {
    return `Session is closed for thread: ${this.threadId}`;
  }
}

export class CodexAppServerMissingProviderThreadError extends Schema.TaggedErrorClass<CodexAppServerMissingProviderThreadError>()(
  "CodexAppServerMissingProviderThreadError",
  {
    threadId: Schema.String,
    operation: Schema.String,
  },
) {
  override get message(): string {
    return `Session is missing provider thread id for ${this.operation}.`;
  }
}

export class CodexAppServerInvalidResponseError extends Schema.TaggedErrorClass<CodexAppServerInvalidResponseError>()(
  "CodexAppServerInvalidResponseError",
  {
    method: Schema.String,
    detail: Schema.String,
    response: Schema.optional(Schema.Unknown),
  },
) {
  override get message(): string {
    return `${this.method} response invalid: ${this.detail}`;
  }
}

export class CodexAppServerProviderRpcError extends Schema.TaggedErrorClass<CodexAppServerProviderRpcError>()(
  "CodexAppServerProviderRpcError",
  {
    method: Schema.String,
    detail: Schema.String,
    code: Schema.optional(Schema.Number),
    response: Schema.optional(Schema.Unknown),
  },
) {
  override get message(): string {
    return `${this.method} failed: ${this.detail}`;
  }
}

export type CodexAppServerError =
  | CodexAppServerProcessSpawnError
  | CodexAppServerVersionCheckError
  | CodexAppServerJsonParseError
  | CodexAppServerInvalidMessageError
  | CodexAppServerRequestTimeoutError
  | CodexAppServerWriteError
  | CodexAppServerUnsupportedRequestError
  | CodexAppServerMissingSessionError
  | CodexAppServerSessionClosedError
  | CodexAppServerMissingProviderThreadError
  | CodexAppServerInvalidResponseError
  | CodexAppServerProviderRpcError;

export interface JsonRpcErrorObject {
  readonly code?: number;
  readonly message?: string;
}

export interface JsonRpcRequest {
  readonly id: string | number;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcResponse {
  readonly id: string | number;
  readonly result?: unknown;
  readonly error?: JsonRpcErrorObject;
}

export interface JsonRpcNotification {
  readonly method: string;
  readonly params?: unknown;
}

export type CodexJsonRpcMessage =
  | { readonly kind: "request"; readonly request: JsonRpcRequest }
  | { readonly kind: "notification"; readonly notification: JsonRpcNotification }
  | { readonly kind: "response"; readonly response: JsonRpcResponse };

export type CodexServerRequest =
  | {
      readonly category: "approval";
      readonly method:
        | "item/commandExecution/requestApproval"
        | "item/fileChange/requestApproval"
        | "item/fileRead/requestApproval"
        | "item/permissions/requestApproval";
      readonly requestKind: ProviderRequestKind;
      readonly request: JsonRpcRequest;
    }
  | {
      readonly category: "user-input";
      readonly method: "item/tool/requestUserInput" | "mcpServer/elicitation/request";
      readonly requestKind?: ProviderRequestKind;
      readonly request: JsonRpcRequest;
    }
  | {
      readonly category: "known-unsupported";
      readonly method: "item/tool/call" | "account/chatgptAuthTokens/refresh";
      readonly requestKind: ProviderRequestKind;
      readonly request: JsonRpcRequest;
    }
  | {
      readonly category: "unknown";
      readonly method: string;
      readonly request: JsonRpcRequest;
      readonly error: CodexAppServerUnsupportedRequestError;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readJsonRpcId(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

export function classifyJsonRpcMessage(
  message: unknown,
): Effect.Effect<CodexJsonRpcMessage, CodexAppServerInvalidMessageError> {
  if (!isRecord(message)) {
    return Effect.fail(
      new CodexAppServerInvalidMessageError({
        detail: "Received non-object protocol message.",
        rawMessage: message,
      }),
    );
  }

  const method = typeof message.method === "string" ? message.method : undefined;
  const id = readJsonRpcId(message.id);
  if (method && id !== undefined) {
    return Effect.succeed({
      kind: "request" as const,
      request: {
        id,
        method,
        ...(message.params !== undefined ? { params: message.params } : {}),
      },
    });
  }

  if (method && id === undefined) {
    return Effect.succeed({
      kind: "notification" as const,
      notification: {
        method,
        ...(message.params !== undefined ? { params: message.params } : {}),
      },
    });
  }

  if (!method && id !== undefined) {
    const rawError = isRecord(message.error) ? message.error : undefined;
    const code = typeof rawError?.code === "number" ? rawError.code : undefined;
    const errorMessage = typeof rawError?.message === "string" ? rawError.message : undefined;
    return Effect.succeed({
      kind: "response" as const,
      response: {
        id,
        ...(message.result !== undefined ? { result: message.result } : {}),
        ...(rawError
          ? {
              error: {
                ...(code !== undefined ? { code } : {}),
                ...(errorMessage !== undefined ? { message: errorMessage } : {}),
              },
            }
          : {}),
      },
    });
  }

  return Effect.fail(
    new CodexAppServerInvalidMessageError({
      detail: "Received protocol message in an unknown shape.",
      rawMessage: message,
    }),
  );
}

export function decodeJsonRpcLine(
  line: string,
): Effect.Effect<
  CodexJsonRpcMessage,
  CodexAppServerJsonParseError | CodexAppServerInvalidMessageError
> {
  return Effect.try({
    try: () => JSON.parse(line) as unknown,
    catch: (cause) =>
      new CodexAppServerJsonParseError({
        line,
        detail: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  }).pipe(Effect.andThen(classifyJsonRpcMessage));
}

export function requestKindForCodexMethod(method: string): ProviderRequestKind | undefined {
  switch (method) {
    case "item/commandExecution/requestApproval":
      return "command";
    case "item/fileRead/requestApproval":
      return "file-read";
    case "item/fileChange/requestApproval":
      return "file-change";
    default:
      return undefined;
  }
}

export function classifyServerRequest(request: JsonRpcRequest): CodexServerRequest {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
    case "item/fileRead/requestApproval":
    case "item/permissions/requestApproval":
      return {
        category: "approval",
        method: request.method,
        requestKind: requestKindForCodexMethod(request.method)!,
        request,
      };
    case "item/tool/requestUserInput":
      return {
        category: "user-input",
        method: request.method,
        request,
      };
    case "mcpServer/elicitation/request":
      return {
        category: "user-input",
        method: request.method,
        request,
      };
    case "item/tool/call":
    case "account/chatgptAuthTokens/refresh":
      return {
        category: "known-unsupported",
        method: request.method,
        requestKind: requestKindForCodexMethod(request.method)!,
        request,
      };
    default:
      return {
        category: "unknown",
        method: request.method,
        request,
        error: new CodexAppServerUnsupportedRequestError({
          method: request.method,
          ...(request.params !== undefined ? { payload: request.params } : {}),
        }),
      };
  }
}

export function providerRpcErrorFromResponse(
  method: string,
  response: JsonRpcResponse,
): CodexAppServerProviderRpcError | undefined {
  const message = response.error?.message;
  if (!message) {
    return undefined;
  }
  return new CodexAppServerProviderRpcError({
    method,
    detail: message,
    ...(response.error?.code !== undefined ? { code: response.error.code } : {}),
    response,
  });
}
