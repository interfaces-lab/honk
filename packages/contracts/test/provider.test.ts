import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  ProviderEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
} from "../src/provider";

const decodeProviderSessionStartInput = Schema.decodeUnknownSync(ProviderSessionStartInput);
const decodeProviderSendTurnInput = Schema.decodeUnknownSync(ProviderSendTurnInput);
const decodeProviderSession = Schema.decodeUnknownSync(ProviderSession);
const decodeProviderEvent = Schema.decodeUnknownSync(ProviderEvent);

function getOptionValue(
  options: ReadonlyArray<{ id: string; value: unknown }> | undefined,
  id: string,
): unknown {
  return options?.find((option) => option.id === id)?.value;
}

describe("ProviderSessionStartInput", () => {
  it("accepts codex payloads", () => {
    const parsed = decodeProviderSessionStartInput({
      threadId: "thread-1",
      provider: "codex",
      providerInstanceId: "codex",
      cwd: "/tmp/project",
      modelSelection: {
        instanceId: "codex",
        model: "gpt-5.3-codex",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      },
      runtimeMode: "full-access",
    });
    const selection = parsed.modelSelection;
    if (!selection) {
      throw new Error("Expected modelSelection");
    }
    expect(parsed.runtimeMode).toBe("full-access");
    expect(parsed.providerInstanceId).toBe("codex");
    expect(selection.instanceId).toBe("codex");
    expect(selection.model).toBe("gpt-5.3-codex");
    expect(getOptionValue(selection.options, "reasoningEffort")).toBe("high");
    expect(getOptionValue(selection.options, "fastMode")).toBe(true);
  });

  it("rejects payloads without runtime mode", () => {
    expect(() =>
      decodeProviderSessionStartInput({
        threadId: "thread-1",
        providerInstanceId: "codex",
      }),
    ).toThrow();
  });

  it("accepts cursor runtime knobs", () => {
    const parsed = decodeProviderSessionStartInput({
      threadId: "thread-1",
      provider: "cursor",
      providerInstanceId: "cursor",
      cwd: "/tmp/project",
      modelSelection: {
        instanceId: "cursor",
        model: "composer-2",
        options: [
          { id: "effort", value: "max" },
          { id: "fastMode", value: true },
        ],
      },
      runtimeMode: "full-access",
    });
    const selection = parsed.modelSelection;
    if (!selection) {
      throw new Error("Expected modelSelection");
    }
    expect(parsed.provider).toBe("cursor");
    expect(parsed.providerInstanceId).toBe("cursor");
    expect(selection.instanceId).toBe("cursor");
    expect(selection.model).toBe("composer-2");
    expect(getOptionValue(selection.options, "effort")).toBe("max");
    expect(getOptionValue(selection.options, "fastMode")).toBe(true);
    expect(parsed.runtimeMode).toBe("full-access");
  });

  it("accepts cursor provider", () => {
    const parsed = decodeProviderSessionStartInput({
      threadId: "thread-1",
      provider: "cursor",
      providerInstanceId: "cursor",
      cwd: "/tmp/project",
      runtimeMode: "full-access",
      modelSelection: {
        instanceId: "cursor",
        model: "composer-2",
        options: [{ id: "fastMode", value: true }],
      },
    });
    const selection = parsed.modelSelection;
    if (!selection) {
      throw new Error("Expected modelSelection");
    }
    expect(parsed.provider).toBe("cursor");
    expect(parsed.providerInstanceId).toBe("cursor");
    expect(selection.instanceId).toBe("cursor");
    expect(selection.model).toBe("composer-2");
    expect(getOptionValue(selection.options, "fastMode")).toBe(true);
  });

  it("rejects unsupported provider driver kinds", () => {
    expect(() =>
      decodeProviderSessionStartInput({
        threadId: "thread-1",
        provider: "ollama",
        providerInstanceId: "ollama_local",
        cwd: "/tmp/project",
        runtimeMode: "full-access",
        modelSelection: {
          instanceId: "ollama_local",
          model: "llama3.3",
        },
      }),
    ).toThrow();
  });
});

describe("ProviderSendTurnInput", () => {
  it("accepts codex modelSelection", () => {
    const parsed = decodeProviderSendTurnInput({
      threadId: "thread-1",
      modelSelection: {
        instanceId: "codex",
        model: "gpt-5.3-codex",
        options: [
          { id: "reasoningEffort", value: "xhigh" },
          { id: "fastMode", value: true },
        ],
      },
    });

    const selection = parsed.modelSelection;
    if (!selection) {
      throw new Error("Expected modelSelection");
    }
    expect(selection.instanceId).toBe("codex");
    expect(selection.model).toBe("gpt-5.3-codex");
    expect(getOptionValue(selection.options, "reasoningEffort")).toBe("xhigh");
    expect(getOptionValue(selection.options, "fastMode")).toBe(true);
  });

  it("accepts custom cursor instance modelSelection options", () => {
    const parsed = decodeProviderSendTurnInput({
      threadId: "thread-1",
      modelSelection: {
        instanceId: "cursor_work",
        model: "composer-2",
        options: [
          { id: "effort", value: "max" },
          { id: "fastMode", value: true },
        ],
      },
    });

    const selection = parsed.modelSelection;
    if (!selection) {
      throw new Error("Expected modelSelection");
    }
    expect(selection.instanceId).toBe("cursor_work");
    expect(getOptionValue(selection.options, "effort")).toBe("max");
    expect(getOptionValue(selection.options, "fastMode")).toBe(true);
  });
});

describe("providerInstanceId routing key", () => {
  it("requires providerInstanceId for ProviderSessionStartInput", () => {
    expect(() =>
      decodeProviderSessionStartInput({
        threadId: "thread-1",
        provider: "codex",
        runtimeMode: "full-access",
      }),
    ).toThrow();
  });

  it("propagates providerInstanceId through ProviderSession decode", () => {
    const session = decodeProviderSession({
      provider: "codex",
      providerInstanceId: "codex_work",
      status: "ready",
      runtimeMode: "full-access",
      threadId: "thread-1",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });
    expect(session.providerInstanceId).toBe("codex_work");
  });

  it("decodes ProviderSession for custom cursor instances", () => {
    const session = decodeProviderSession({
      provider: "cursor",
      providerInstanceId: "cursor_work",
      status: "ready",
      runtimeMode: "full-access",
      threadId: "thread-1",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });

    expect(session.provider).toBe("cursor");
    expect(session.providerInstanceId).toBe("cursor_work");
  });

  it("decodes a ProviderEvent carrying driver metadata and instance routing", () => {
    const event = decodeProviderEvent({
      id: "event-1",
      kind: "notification",
      provider: "codex",
      providerInstanceId: "codex_personal",
      threadId: "thread-1",
      createdAt: "2024-01-01T00:00:00Z",
      method: "session.created",
    });
    expect(event.provider).toBe("codex");
    expect(event.providerInstanceId).toBe("codex_personal");
  });

  it("rejects providerInstanceId values that fail the slug pattern", () => {
    expect(() =>
      decodeProviderSessionStartInput({
        threadId: "thread-1",
        provider: "codex",
        providerInstanceId: "1bad",
        runtimeMode: "full-access",
      }),
    ).toThrow();
  });
});
