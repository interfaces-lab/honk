import "../../../index.css";
import "../../../styles/tokens.css";
import "../../../styles/app.css";

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelPicker } from "./model";
import type { RuntimeModelItem } from "~/lib/runtime-models";
import type { ThinkingLevel } from "~/lib/ui-session-types";

const fastModel: RuntimeModelItem = {
  key: "codex/gpt-5.4",
  provider: "codex",
  id: "gpt-5.4",
  name: "GPT-5.4",
  reasoning: false,
  supportsFastMode: true,
  supportsXhigh: false,
};

const slowModel: RuntimeModelItem = {
  ...fastModel,
  key: "claude/claude-sonnet-4-6",
  provider: "claudeAgent",
  id: "claude-sonnet-4-6",
  name: "Claude Sonnet 4.6",
  supportsFastMode: false,
};

function Harness(props: { item: RuntimeModelItem; thinking?: boolean }) {
  const [fast, setFast] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(
    props.item.reasoning ? "medium" : "off",
  );
  return (
    <ModelPicker
      items={[props.item]}
      selection={{
        model: {
          provider: props.item.provider,
          id: props.item.id,
          name: props.item.name,
          reasoning: Boolean(props.item.reasoning),
        },
        fastMode: fast,
        ...(props.thinking ? { thinkingLevel } : {}),
      }}
      variant="settings"
      onSelect={() => {}}
      onFastMode={setFast}
      {...(props.thinking ? { onThinkingLevel: setThinkingLevel } : {})}
    />
  );
}

async function mount(item: RuntimeModelItem, options: { thinking?: boolean } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  root.render(
    <Harness
      item={item}
      {...(options.thinking !== undefined ? { thinking: options.thinking } : {})}
    />,
  );
  await Promise.resolve();
  const cleanup = async () => {
    root.unmount();
    host.remove();
  };
  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
  };
}

describe("ModelPicker", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows fast mode trigger state for supported models", async () => {
    await using _ = await mount(fastModel);

    await page.getByRole("button").click();

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").toContain("Fast: Off");
    });
  });

  it("hides fast mode controls for unsupported models", async () => {
    await using _ = await mount(slowModel);

    await page.getByRole("button").click();

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").not.toContain("Fast Mode");
    });
  });

  it("shows the Cursor MAX confirmation flow before enabling MAX mode", async () => {
    await using _ = await mount(
      {
        ...fastModel,
        reasoning: true,
        supportsXhigh: true,
      },
      { thinking: true },
    );

    await page.getByRole("button").click();
    await page.getByText("MAX Mode").click();

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").toContain("Enable MAX Mode?");
    });

    await page.getByRole("button", { name: "Enable MAX" }).click();

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").toContain("MAX");
      expect(document.body.textContent ?? "").toContain("Thinking: Extra High");
    });
  });
});
