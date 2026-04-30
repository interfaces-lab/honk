import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import type { ServerProviderModel } from "@multi/contracts";
import { TraitsPicker } from "./traits-picker";

const MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "gpt-5.4",
    name: "GPT-5.4",
    isCustom: false,
    capabilities: {
      optionDescriptors: [
        {
          id: "reasoningEffort",
          label: "Effort",
          type: "select",
          currentValue: "medium",
          options: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium", isDefault: true },
          ],
        },
      ],
    },
  },
];

describe("TraitsPicker", () => {
  it("renders provider option labels from model descriptors", async () => {
    render(
      <TraitsPicker
        provider="codex"
        models={MODELS}
        model="gpt-5.4"
        prompt=""
        onPromptChange={() => undefined}
        onModelOptionsChange={() => undefined}
      />,
    );

    await expect.element(page.getByRole("button", { name: /Medium/ })).toBeVisible();
  });
});
