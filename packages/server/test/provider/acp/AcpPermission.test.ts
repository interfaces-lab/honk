import { describe, expect, it } from "vitest";

import type * as EffectAcpSchema from "effect-acp/schema";

import {
  acpPermissionOutcome,
  DEFAULT_ACP_PERMISSION_OPTIONS,
  parsePermissionRequest,
} from "../../../src/provider/acp/AcpPermission.ts";

// Adapted from anomalyco/opencode packages/opencode/test/acp/permission.test.ts.
describe("AcpPermission", () => {
  it("defines the standard permission option ids Multi sends back to ACP agents", () => {
    expect(DEFAULT_ACP_PERMISSION_OPTIONS).toEqual([
      { optionId: "allow-once", kind: "allow_once", name: "Allow once" },
      { optionId: "allow-always", kind: "allow_always", name: "Always allow" },
      { optionId: "reject-once", kind: "reject_once", name: "Reject" },
    ]);
  });

  it("maps provider approval decisions to ACP permission outcomes", () => {
    expect(acpPermissionOutcome("accept")).toBe("allow-once");
    expect(acpPermissionOutcome("acceptForSession")).toBe("allow-always");
    expect(acpPermissionOutcome("decline")).toBe("reject-once");
    expect(acpPermissionOutcome("cancel")).toBe("reject-once");
  });

  it("parses typed ACP permission requests into provider permission details", () => {
    const request = parsePermissionRequest({
      sessionId: "session-1",
      options: [
        {
          optionId: "allow-once",
          name: "Allow once",
          kind: "allow_once",
        },
      ],
      toolCall: {
        toolCallId: "tool-1",
        title: "`cat package.json`",
        kind: "execute",
        status: "pending",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "Not in allowlist",
            },
          },
        ],
      },
    } satisfies EffectAcpSchema.RequestPermissionRequest);

    expect(request).toMatchObject({
      kind: "execute",
      detail: "cat package.json",
      toolCall: {
        toolCallId: "tool-1",
        kind: "execute",
        status: "pending",
        command: "cat package.json",
      },
    });
  });
});
