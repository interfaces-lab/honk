import * as React from "react";

import { ThreadPageLoading } from "./page-layout";

type ThreadPageModule = typeof import("./page");

let threadPagePromise: Promise<ThreadPageModule> | null = null;

export function loadThreadPage(): Promise<ThreadPageModule> {
  threadPagePromise ??= import("./page");
  return threadPagePromise;
}

const DeferredThreadPage = React.lazy(() =>
  loadThreadPage().then((module) => ({ default: module.ThreadPage })),
);

export function ThreadPageRoute(): React.ReactElement {
  return (
    <React.Suspense fallback={<ThreadPageLoading />}>
      <DeferredThreadPage />
    </React.Suspense>
  );
}
