import { RouterDevtoolsPanel } from "./router-devtools";

export function DevDevtoolsPanel() {
  if (!import.meta.env.DEV) {
    return null;
  }

  return <RouterDevtoolsPanel />;
}
