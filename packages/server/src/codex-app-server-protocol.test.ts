import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Schema } from "effect";

import {
  CodexAppServerInvalidMessageError,
  CodexAppServerJsonParseError,
  CodexAppServerUnsupportedRequestError,
  classifyServerRequest,
  decodeJsonRpcLine,
  requestKindForCodexMethod,
} from "./codex-app-server-protocol";

function runDecode(line: string) {
  return Effect.runSync(Effect.exit(decodeJsonRpcLine(line)));
}

function failureTag(exit: Exit.Exit<unknown, unknown>): string | undefined {
  if (!Exit.isFailure(exit)) {
    return undefined;
  }
  const error = Cause.squash(exit.cause);
  if (Schema.is(CodexAppServerJsonParseError)(error)) {
    return "CodexAppServerJsonParseError";
  }
  if (Schema.is(CodexAppServerInvalidMessageError)(error)) {
    return "CodexAppServerInvalidMessageError";
  }
  return undefined;
}

it("classifies JSON-RPC responses, notifications, and server requests", () => {
  const response = runDecode(JSON.stringify({ id: 1, result: { ok: true } }));
  assert.strictEqual(Exit.isSuccess(response), true);
  if (Exit.isSuccess(response)) {
    assert.strictEqual(response.value.kind, "response");
  }

  const notification = runDecode(JSON.stringify({ method: "turn/started", params: {} }));
  assert.strictEqual(Exit.isSuccess(notification), true);
  if (Exit.isSuccess(notification)) {
    assert.strictEqual(notification.value.kind, "notification");
  }

  const request = runDecode(
    JSON.stringify({ id: "approval-1", method: "item/permissions/requestApproval", params: {} }),
  );
  assert.strictEqual(Exit.isSuccess(request), true);
  if (Exit.isSuccess(request)) {
    assert.strictEqual(request.value.kind, "request");
  }
});

it("returns typed protocol errors for invalid JSON and malformed messages", () => {
  assert.strictEqual(failureTag(runDecode("{nope")), "CodexAppServerJsonParseError");
  assert.strictEqual(
    failureTag(runDecode(JSON.stringify(["not", "an", "object"]))),
    "CodexAppServerInvalidMessageError",
  );
  assert.strictEqual(
    failureTag(runDecode(JSON.stringify({ jsonrpc: "2.0" }))),
    "CodexAppServerInvalidMessageError",
  );
});

it("maps current Codex server request methods to constrained request kinds", () => {
  assert.strictEqual(requestKindForCodexMethod("item/commandExecution/requestApproval"), "command");
  assert.strictEqual(requestKindForCodexMethod("item/fileRead/requestApproval"), "file-read");
  assert.strictEqual(requestKindForCodexMethod("item/fileChange/requestApproval"), "file-change");
  assert.strictEqual(requestKindForCodexMethod("item/permissions/requestApproval"), "permissions");
  assert.strictEqual(requestKindForCodexMethod("mcpServer/elicitation/request"), "mcp-elicitation");
  assert.strictEqual(requestKindForCodexMethod("item/tool/call"), "dynamic-tool");
  assert.strictEqual(
    requestKindForCodexMethod("account/chatgptAuthTokens/refresh"),
    "auth-refresh",
  );
  assert.strictEqual(requestKindForCodexMethod("unknown/method"), undefined);
});

it("classifies known, known-unsupported, and unknown server requests", () => {
  const approval = classifyServerRequest({
    id: 1,
    method: "item/permissions/requestApproval",
    params: {},
  });
  assert.strictEqual(approval.category, "approval");
  assert.strictEqual(approval.requestKind, "permissions");

  const elicitation = classifyServerRequest({
    id: 2,
    method: "mcpServer/elicitation/request",
    params: {},
  });
  assert.strictEqual(elicitation.category, "user-input");
  assert.strictEqual(elicitation.requestKind, "mcp-elicitation");

  const dynamicTool = classifyServerRequest({ id: 3, method: "item/tool/call", params: {} });
  assert.strictEqual(dynamicTool.category, "known-unsupported");
  assert.strictEqual(dynamicTool.requestKind, "dynamic-tool");

  const unknown = classifyServerRequest({ id: 4, method: "brand/new/request", params: {} });
  assert.strictEqual(unknown.category, "unknown");
  if (unknown.category === "unknown") {
    assert.strictEqual(Schema.is(CodexAppServerUnsupportedRequestError)(unknown.error), true);
  }
});
