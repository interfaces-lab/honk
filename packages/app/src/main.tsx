import { createBrowserHistory, createHashHistory } from "@tanstack/react-router";

import { isElectron } from "./env";
import { mountMultiApp } from "./renderer";

mountMultiApp({
  history: isElectron ? createHashHistory() : createBrowserHistory(),
  isElectron,
});
