import { lazy, Suspense } from "react";

const TanStackDevtoolsPanel = lazy(async () => {
  const module = await import("./router-devtools");
  return { default: module.TanStackDevtoolsPanel };
});

export function DevDevtoolsPanel() {
  if (!import.meta.env.DEV) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <TanStackDevtoolsPanel />
    </Suspense>
  );
}
