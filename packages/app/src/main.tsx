import { createBrowserHistory, createHashHistory } from "@tanstack/react-router";

import { isElectron } from "./env";
import { mountHonkApp } from "./renderer";

mountHonkApp({
  history: isElectron ? createHashHistory() : createBrowserHistory(),
  isElectron,
});
