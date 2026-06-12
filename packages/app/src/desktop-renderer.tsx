import { createHashHistory } from "@tanstack/react-router";

import { mountHonkApp } from "./renderer";

export function mountDesktopHonkApp(): void {
  mountHonkApp({
    history: createHashHistory(),
    isElectron: true,
  });
}
