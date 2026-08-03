import { Icon } from "@honk/ui";
import { IconCupHot } from "@honk/ui/icons";

import { defineHonkDesktopExtension } from "../sdk";

export const keepAwakeExtension = defineHonkDesktopExtension({
  id: "keep-awake",
  name: "Keep Awake",
  version: "1.0.0",
  activate(context) {
    const enabled = context.state.boolean("enabled", false);
    let pending = Promise.resolve();

    const synchronize = (requested: boolean): void => {
      pending = pending
        .catch(() => undefined)
        .then(async () => {
          const actual = await context.desktop.power.setKeepAwake(requested);
          if (enabled.get() === requested && actual !== requested) {
            enabled.set(actual);
          }
        });
      void pending.catch((error) => {
        console.error("[honk:desktop-extension:keep-awake]", error);
      });
    };

    synchronize(enabled.get());
    context.lifecycle.own(enabled.subscribe(synchronize));

    context.desktop.settings.toggle({
      id: "enabled",
      title: "Keep display awake",
      description: "Prevent the display from sleeping while Honk is open.",
      section: "general",
      value: enabled,
    });
    context.desktop.titlebar.toggle({
      id: "enabled",
      label: "Keep display awake",
      value: enabled,
      icon: () => <Icon icon={IconCupHot} size="sm" />,
    });
  },
});
