import { describe, expect, it } from "vitest";
import * as EffectAcpErrors from "effect-acp/errors";

import { ProviderDriverKind, ThreadId } from "@multi/contracts";

import * as AcpError from "../../../src/provider/acp/AcpError.ts";

// Adapted from anomalyco/opencode packages/opencode/test/acp/error.test.ts.
describe("AcpError", () => {
  it("maps validation failures to invalid params", () => {
    const cases: AcpError.Error[] = [
      new AcpError.SessionNotFoundError({ sessionId: "ses_missing" }),
      new AcpError.InvalidConfigOptionError({ configId: "temperature" }),
      new AcpError.InvalidModelError({
        providerId: "anthropic",
        modelId: "claude-missing",
      }),
      new AcpError.InvalidEffortError({ effort: "extreme" }),
      new AcpError.InvalidModeError({ mode: "turbo" }),
    ];

    expect(cases.map((error) => AcpError.toRequestError(error).code)).toEqual([
      -32602,
      -32602,
      -32602,
      -32602,
      -32602,
    ]);
  });

  it("includes safe validation details", () => {
    expect(AcpError.toRequestError(new AcpError.SessionNotFoundError({ sessionId: "ses_123" }))).toMatchObject({
      code: -32602,
      data: { sessionId: "ses_123" },
    });
    expect(AcpError.toRequestError(new AcpError.InvalidModelError({ modelId: "gpt-missing" }))).toMatchObject({
      code: -32602,
      data: { modelId: "gpt-missing" },
    });
  });

  it("maps auth required to an ACP auth request error", () => {
    const requestError = AcpError.toRequestError(
      new AcpError.AuthRequiredError({ providerId: "cursor" }),
    );

    expect(requestError).toBeInstanceOf(EffectAcpErrors.AcpRequestError);
    expect(requestError.code).toBe(-32000);
    expect(requestError.message).toBe("provider authentication required");
    expect(requestError.data).toEqual({ providerId: "cursor" });
  });

  it("maps unsupported operations to method not found", () => {
    const requestError = AcpError.toRequestError(
      new AcpError.UnsupportedOperationError({ method: "session/new" }),
    );

    expect(requestError.code).toBe(-32601);
    expect(requestError.message).toBe("Method not found: session/new");
  });

  it("maps service failures to safe internal errors", () => {
    const requestError = AcpError.toRequestError(
      new AcpError.ServiceFailureError({
        service: "provider",
        safeMessage: "Provider request failed",
      }),
    );

    expect(requestError.code).toBe(-32603);
    expect(requestError.message).toBe("Provider request failed");
    expect(requestError.data).toEqual({ service: "provider" });
  });

  it("wraps unknown defects without leaking raw details", () => {
    const requestError = AcpError.toRequestError(
      AcpError.fromUnknownDefect(new Error("stack has sk-ant-secret and oauth refresh token")),
    );
    const serialized = JSON.stringify(requestError.toProtocolError());

    expect(requestError.code).toBe(-32603);
    expect(requestError.message).toBe("Internal service failure");
    expect(serialized).not.toContain("sk-ant-secret");
    expect(serialized).not.toContain("oauth refresh token");
    expect(serialized).not.toContain("stack");
  });

  it("maps ACP transport errors to provider adapter errors", () => {
    const error = AcpError.mapAcpToAdapterError(
      ProviderDriverKind.make("cursor"),
      ThreadId.make("thread-1"),
      "session/prompt",
      new EffectAcpErrors.AcpRequestError({
        code: -32602,
        errorMessage: "Invalid params",
      }),
    );

    expect(error._tag).toBe("ProviderAdapterRequestError");
    expect(error.message).toContain("Invalid params");
  });
});
