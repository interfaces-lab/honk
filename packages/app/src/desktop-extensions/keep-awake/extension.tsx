import { Icon } from "@honk/ui";
import { IconSendLater, IconSleep } from "@honk/ui/icons";

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
      value: enabled,
    });
    context.desktop.newSession.toggle({
      id: "enabled",
      title: "Keep display awake",
      description: "Prevent the display from sleeping while Honk is open.",
      value: enabled,
      icon: (active) => <Icon icon={active ? IconSendLater : IconSleep} size="sm" />,
    });
  },
});
