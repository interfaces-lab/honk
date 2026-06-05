import { createHashHistory } from "@tanstack/react-router";

import { mountMultiApp } from "./renderer";

export function mountDesktopMultiApp(): void {
  mountMultiApp({
    history: createHashHistory(),
    isElectron: true,
  });
}
