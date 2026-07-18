import { describe, expect, it } from "vitest";

import { openCodeGoPreset } from "./presets";

const model = (
  providerID: string,
  id: string,
  options?: { readonly enabled?: boolean; readonly variants?: readonly string[] },
) => ({
  providerID,
  id,
  name: id === "kimi-k3" ? "Kimi K3" : id,
  enabled: options?.enabled ?? true,
  variants: (options?.variants ?? []).map((variant) => ({
    id: variant,
    headers: {},
    body: {},
  })),
});

describe("OpenCode Go preset", () => {
  it("admits only the enabled opencode-go Kimi K3 catalog entry", () => {
    const preset = openCodeGoPreset([
      model("opencode-go", "glm-5.2"),
      model("moonshotai", "kimi-k3"),
      model("opencode-go", "kimi-k3", { enabled: false }),
      model("opencode-go", "kimi-k3", { variants: ["high", "max"] }),
    ]);

    expect(preset).toMatchObject({
      id: "kimi-k3",
      label: "Kimi K3",
      mainModel: { providerID: "opencode-go", id: "kimi-k3" },
      mainVariant: "max",
    });
    expect(preset).not.toHaveProperty("sidekickModel");
  });

  it("keeps Kimi K3 out of the picker until the live catalog exposes it", () => {
    expect(openCodeGoPreset([model("opencode-go", "glm-5.2")])).toBeNull();
  });
});
