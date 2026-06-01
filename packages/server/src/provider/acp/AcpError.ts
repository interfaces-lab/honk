import type { ProviderDriverKind, ThreadId } from "@multi/contracts";
import { Schema } from "effect";
import * as EffectAcpErrors from "effect-acp/errors";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  type ProviderAdapterError,
} from "../Errors.ts";

export class SessionNotFoundError extends Schema.TaggedErrorClass<SessionNotFoundError>()(
  "ACPSessionNotFoundError",
  {
    sessionId: Schema.String,
  },
) {}

export class InvalidConfigOptionError extends Schema.TaggedErrorClass<InvalidConfigOptionError>()(
  "ACPInvalidConfigOptionError",
  {
    configId: Schema.String,
  },
) {}

export class InvalidModelError extends Schema.TaggedErrorClass<InvalidModelError>()(
  "ACPInvalidModelError",
  {
    modelId: Schema.String,
    providerId: Schema.optional(Schema.String),
  },
) {}

export class InvalidEffortError extends Schema.TaggedErrorClass<InvalidEffortError>()(
  "ACPInvalidEffortError",
  {
    effort: Schema.String,
  },
) {}

export class InvalidModeError extends Schema.TaggedErrorClass<InvalidModeError>()(
  "ACPInvalidModeError",
  {
    mode: Schema.String,
  },
) {}

export class AuthRequiredError extends Schema.TaggedErrorClass<AuthRequiredError>()(
  "ACPAuthRequiredError",
  {
    providerId: Schema.optional(Schema.String),
  },
) {}

export class UnknownAuthMethodError extends Schema.TaggedErrorClass<UnknownAuthMethodError>()(
  "ACPUnknownAuthMethodError",
  {
    methodId: Schema.String,
  },
) {}

export class UnsupportedOperationError extends Schema.TaggedErrorClass<UnsupportedOperationError>()(
  "ACPUnsupportedOperationError",
  {
    method: Schema.String,
  },
) {}

export class ServiceFailureError extends Schema.TaggedErrorClass<ServiceFailureError>()(
  "ACPServiceFailureError",
  {
    safeMessage: Schema.String,
    service: Schema.optional(Schema.String),
  },
) {}

export type Error =
  | SessionNotFoundError
  | InvalidConfigOptionError
  | InvalidModelError
  | InvalidEffortError
  | InvalidModeError
  | AuthRequiredError
  | UnknownAuthMethodError
  | UnsupportedOperationError
  | ServiceFailureError;

const isAcpProcessExitedError = Schema.is(EffectAcpErrors.AcpProcessExitedError);
const isAcpRequestError = Schema.is(EffectAcpErrors.AcpRequestError);

export function toRequestError(error: Error): EffectAcpErrors.AcpRequestError {
  switch (error._tag) {
    case "ACPSessionNotFoundError":
      return EffectAcpErrors.AcpRequestError.invalidParams(`session not found: ${error.sessionId}`, {
        sessionId: error.sessionId,
      });
    case "ACPInvalidConfigOptionError":
      return EffectAcpErrors.AcpRequestError.invalidParams(
        `unknown config option: ${error.configId}`,
        { configId: error.configId },
      );
    case "ACPInvalidModelError":
      return EffectAcpErrors.AcpRequestError.invalidParams(`model not found: ${error.modelId}`, {
        ...(error.providerId !== undefined ? { providerId: error.providerId } : {}),
        modelId: error.modelId,
      });
    case "ACPInvalidEffortError":
      return EffectAcpErrors.AcpRequestError.invalidParams(`effort not found: ${error.effort}`, {
        effort: error.effort,
      });
    case "ACPInvalidModeError":
      return EffectAcpErrors.AcpRequestError.invalidParams(`mode not found: ${error.mode}`, {
        mode: error.mode,
      });
    case "ACPAuthRequiredError":
      return EffectAcpErrors.AcpRequestError.authRequired("provider authentication required", {
        ...(error.providerId !== undefined ? { providerId: error.providerId } : {}),
      });
    case "ACPUnknownAuthMethodError":
      return EffectAcpErrors.AcpRequestError.invalidParams(
        `unknown auth method: ${error.methodId}`,
        { methodId: error.methodId },
      );
    case "ACPUnsupportedOperationError":
      return EffectAcpErrors.AcpRequestError.methodNotFound(error.method);
    case "ACPServiceFailureError":
      return EffectAcpErrors.AcpRequestError.internalError(error.safeMessage, {
        ...(error.service !== undefined ? { service: error.service } : {}),
      });
  }
}

export function fromUnknownDefect(
  _defect: unknown,
  safeMessage = "Internal service failure",
): ServiceFailureError {
  return new ServiceFailureError({ safeMessage });
}

export function mapAcpToAdapterError(
  provider: ProviderDriverKind,
  threadId: ThreadId,
  method: string,
  error: EffectAcpErrors.AcpError,
): ProviderAdapterError {
  if (isAcpProcessExitedError(error)) {
    return new ProviderAdapterSessionClosedError({
      provider,
      threadId,
      cause: error,
    });
  }
  if (isAcpRequestError(error)) {
    return new ProviderAdapterRequestError({
      provider,
      method,
      detail: error.message,
      cause: error,
    });
  }
  return new ProviderAdapterRequestError({
    provider,
    method,
    detail: error.message,
    cause: error,
  });
}
