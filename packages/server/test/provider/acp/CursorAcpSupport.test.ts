import { Effect, Schema } from "effect";
import type * as EffectAcpSchema from "effect-acp/schema";
import { describe, expect, it } from "vitest";

import {
  applyCursorAcpModelSelection,
  buildCursorAcpSpawnInput,
  type CursorAcpModelSelectionErrorContext,
} from "../../../src/provider/acp/CursorAcpSupport.ts";

const parameterizedGpt54ConfigOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "gpt-5.4-medium-fast",
    options: [{ value: "gpt-5.4-medium-fast", name: "GPT-5.4" }],
  },
  {
    id: "reasoning",
    name: "Reasoning",
    category: "thought_level",
    type: "select",
    currentValue: "medium",
    options: [
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
      { value: "extra-high", name: "Extra High" },
    ],
  },
  {
    id: "context",
    name: "Context",
    category: "model_config",
    type: "select",
    currentValue: "272k",
    options: [
      { value: "272k", name: "272K" },
      { value: "1m", name: "1M" },
    ],
  },
  {
    id: "fast",
    name: "Fast",
    category: "model_config",
    type: "select",
    currentValue: "false",
    options: [
      { value: "false", name: "Off" },
      { value: "true", name: "Fast" },
    ],
  },
];

const modelOnlyConfigOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> = [
  {
    id: "mode",
    name: "Mode",
    category: "mode",
    type: "select",
    currentValue: "agent",
    options: [{ value: "agent", name: "Agent" }],
  },
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "kimi-k2.5",
    options: [
      { value: "composer-2.5", name: "Composer 2.5" },
      { value: "kimi-k2.5", name: "Kimi K2.5" },
    ],
  },
];

class CursorAcpModelSelectionTestError extends Schema.TaggedErrorClass<CursorAcpModelSelectionTestError>()(
  "CursorAcpModelSelectionTestError",
  {
    step: Schema.Union([Schema.Literal("set-config-option"), Schema.Literal("set-model")]),
    method: Schema.Union([
      Schema.Literal("session/set_config_option"),
      Schema.Literal("session/set_model"),
    ]),
    configId: Schema.optional(Schema.String),
    detail: Schema.String,
    cause: Schema.Defect,
  },
) {
  override get message(): string {
    if (this.configId) {
      return `${this.method} failed for ${this.configId}: ${this.detail}`;
    }
    return `${this.method} failed: ${this.detail}`;
  }
}

const mapCursorAcpModelSelectionTestError = (
  context: CursorAcpModelSelectionErrorContext,
): CursorAcpModelSelectionTestError => {
  if (context.step === "set-config-option") {
    return new CursorAcpModelSelectionTestError({
      step: context.step,
      method: context.method,
      configId: context.configId,
      detail: context.cause.message,
      cause: context.cause,
    });
  }
  return new CursorAcpModelSelectionTestError({
    step: context.step,
    method: context.method,
    detail: context.cause.message,
    cause: context.cause,
  });
};

describe("buildCursorAcpSpawnInput", () => {
  it("builds the default Cursor ACP command", () => {
    expect(buildCursorAcpSpawnInput(undefined, "/tmp/project")).toEqual({
      command: "agent",
      args: ["acp"],
      cwd: "/tmp/project",
    });
  });

  it("includes the configured api endpoint when present", () => {
    expect(
      buildCursorAcpSpawnInput(
        {
          binaryPath: "/usr/local/bin/agent",
          apiEndpoint: "http://localhost:3000",
        },
        "/tmp/project",
      ),
    ).toEqual({
      command: "/usr/local/bin/agent",
      args: ["-e", "http://localhost:3000", "acp"],
      cwd: "/tmp/project",
    });
  });
});

describe("applyCursorAcpModelSelection", () => {
  it("sets the base model before applying separate config options", async () => {
    const calls: Array<
      | { readonly type: "model"; readonly value: string }
      | { readonly type: "config"; readonly configId: string; readonly value: string | boolean }
    > = [];

    const runtime = {
      getConfigOptions: Effect.succeed(parameterizedGpt54ConfigOptions),
      setModel: (value: string) =>
        Effect.sync(() => {
          calls.push({ type: "model", value });
        }),
      setConfigOption: (configId: string, value: string | boolean) =>
        Effect.sync(() => {
          calls.push({ type: "config", configId, value });
        }),
    };

    await Effect.runPromise(
      applyCursorAcpModelSelection({
        runtime,
        model: "gpt-5.4-medium-fast[reasoning=medium,context=272k]",
        selections: [
          { id: "reasoning", value: "xhigh" },
          { id: "contextWindow", value: "1m" },
          { id: "fastMode", value: true },
        ],
        mapError: mapCursorAcpModelSelectionTestError,
      }),
    );

    expect(calls).toEqual([
      { type: "model", value: "gpt-5.4-medium-fast" },
      { type: "config", configId: "reasoning", value: "extra-high" },
      { type: "config", configId: "context", value: "1m" },
      { type: "config", configId: "fast", value: "true" },
    ]);
  });

  it("does not send stale option selections when Cursor exposes no matching config option", async () => {
    const calls: Array<
      | { readonly type: "model"; readonly value: string }
      | { readonly type: "config"; readonly configId: string; readonly value: string | boolean }
    > = [];

    const runtime = {
      getConfigOptions: Effect.succeed(modelOnlyConfigOptions),
      setModel: (value: string) =>
        Effect.sync(() => {
          calls.push({ type: "model", value });
        }),
      setConfigOption: (configId: string, value: string | boolean) =>
        Effect.sync(() => {
          calls.push({ type: "config", configId, value });
        }),
    };

    await Effect.runPromise(
      applyCursorAcpModelSelection({
        runtime,
        model: "kimi-k2.5",
        selections: [
          { id: "reasoning", value: "high" },
          { id: "thinking", value: true },
          { id: "fastMode", value: true },
        ],
        mapError: mapCursorAcpModelSelectionTestError,
      }),
    );

    expect(calls).toEqual([{ type: "model", value: "kimi-k2.5" }]);
  });
});
