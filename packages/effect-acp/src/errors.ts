import * as Schema from "effect/Schema";

import * as AcpSchema from "./_generated/schema.gen.ts";

function readErrorDataDetail(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  const detail = record.details ?? record.message;
  return typeof detail === "string" && detail.trim().length > 0 ? detail.trim() : undefined;
}

export class AcpSpawnError extends Schema.TaggedErrorClass<AcpSpawnError>()("AcpSpawnError", {
  command: Schema.optional(Schema.String),
  cause: Schema.Defect,
}) {
  override get message() {
    return this.command
      ? `Failed to spawn ACP process for command: ${this.command}`
      : "Failed to spawn ACP process";
  }
}

export class AcpProcessExitedError extends Schema.TaggedErrorClass<AcpProcessExitedError>()(
  "AcpProcessExitedError",
  {
    code: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message() {
    return this.code === undefined
      ? "ACP process exited"
      : `ACP process exited with code ${this.code}`;
  }
}

export class AcpProtocolParseError extends Schema.TaggedErrorClass<AcpProtocolParseError>()(
  "AcpProtocolParseError",
  {
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message() {
    return `Failed to parse ACP protocol message: ${this.detail}`;
  }
}

export class AcpTransportError extends Schema.TaggedErrorClass<AcpTransportError>()(
  "AcpTransportError",
  {
    detail: Schema.String,
    cause: Schema.Defect,
  },
) {}

export class AcpRequestError extends Schema.TaggedErrorClass<AcpRequestError>()("AcpRequestError", {
  code: AcpSchema.ErrorCode,
  errorMessage: Schema.String,
  data: Schema.optional(Schema.Unknown),
}) {
  override get message() {
    const detail = readErrorDataDetail(this.data);
    if (!detail || detail === this.errorMessage) {
      return this.errorMessage;
    }
    return `${this.errorMessage}: ${detail}`;
  }

  static fromProtocolError(error: AcpSchema.Error) {
    return new AcpRequestError({
      code: error.code,
      errorMessage: error.message,
      ...(error.data !== undefined ? { data: error.data } : {}),
    });
  }

  static parseError(message = "Parse error", data?: unknown) {
    return new AcpRequestError({
      code: -32700,
      errorMessage: message,
      ...(data !== undefined ? { data } : {}),
    });
  }

  static invalidRequest(message = "Invalid request", data?: unknown) {
    return new AcpRequestError({
      code: -32600,
      errorMessage: message,
      ...(data !== undefined ? { data } : {}),
    });
  }

  static methodNotFound(method: string) {
    return new AcpRequestError({
      code: -32601,
      errorMessage: `Method not found: ${method}`,
    });
  }

  static invalidParams(message = "Invalid params", data?: unknown) {
    return new AcpRequestError({
      code: -32602,
      errorMessage: message,
      ...(data !== undefined ? { data } : {}),
    });
  }

  static internalError(message = "Internal error", data?: unknown) {
    return new AcpRequestError({
      code: -32603,
      errorMessage: message,
      ...(data !== undefined ? { data } : {}),
    });
  }

  static authRequired(message = "Authentication required", data?: unknown) {
    return new AcpRequestError({
      code: -32000,
      errorMessage: message,
      ...(data !== undefined ? { data } : {}),
    });
  }

  static resourceNotFound(message = "Resource not found", data?: unknown) {
    return new AcpRequestError({
      code: -32002,
      errorMessage: message,
      ...(data !== undefined ? { data } : {}),
    });
  }

  toProtocolError() {
    return AcpSchema.Error.make({
      code: this.code,
      message: this.errorMessage,
      ...(this.data !== undefined ? { data: this.data } : {}),
    });
  }
}

export const AcpError = Schema.Union([
  AcpRequestError,
  AcpSpawnError,
  AcpProcessExitedError,
  AcpProtocolParseError,
  AcpTransportError,
]);

export type AcpError = typeof AcpError.Type;
