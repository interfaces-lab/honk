import { MessageId } from "@honk/contracts";
import { describe, expect, it } from "vitest";
import {
  isOrchestrationPersistedMessageId,
  isRuntimeSessionTreeProjectionMessageId,
} from "../src/thread-tree";

describe("isOrchestrationPersistedMessageId", () => {
  it("accepts orchestration message ids without runtime projection separators", () => {
    expect(
      isOrchestrationPersistedMessageId(MessageId.make("019ea90a-5f4f-7a22-8067-ef9980854afd")),
    ).toBe(true);
  });

  it("accepts persisted runtime-prefixed message ids", () => {
    expect(
      isOrchestrationPersistedMessageId(
        MessageId.make("runtime:runtime:persistence:runtime:assistant"),
      ),
    ).toBe(true);
  });

  it("rejects runtime session projection message ids", () => {
    expect(
      isOrchestrationPersistedMessageId(
        MessageId.make("019ea90a-5f4f-7a22-8067-ef9980854afd:56aa747e"),
      ),
    ).toBe(false);
  });
});

describe("isRuntimeSessionTreeProjectionMessageId", () => {
  it("detects runtime session tree projection message ids", () => {
    expect(
      isRuntimeSessionTreeProjectionMessageId(
        MessageId.make("runtime:019ea90a-5f4f-7a22-8067-ef9980854afd:56aa747e"),
      ),
    ).toBe(true);
  });

  it("rejects plain orchestration and legacy runtime ids", () => {
    expect(
      isRuntimeSessionTreeProjectionMessageId(
        MessageId.make("019ea90a-5f4f-7a22-8067-ef9980854afd"),
      ),
    ).toBe(false);
    expect(
      isRuntimeSessionTreeProjectionMessageId(
        MessageId.make("runtime:runtime:persistence:runtime:assistant"),
      ),
    ).toBe(false);
  });
});
