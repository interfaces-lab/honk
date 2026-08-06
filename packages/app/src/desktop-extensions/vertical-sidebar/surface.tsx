import { lazy, Suspense, type ReactElement } from "react";

import { VerticalSidebarLoading } from "./loading";
import { loadVerticalSidebarView } from "./resource";
import type { VerticalSidebarInput } from "./types";

const DeferredVerticalSidebar = lazy(() =>
  loadVerticalSidebarView().then((module) => ({ default: module.VerticalSidebar })),
);

function VerticalSidebarSurface(input: VerticalSidebarInput): ReactElement {
  return (
    <Suspense fallback={<VerticalSidebarLoading />}>
      <DeferredVerticalSidebar {...input} />
    </Suspense>
  );
}

export { VerticalSidebarSurface };
