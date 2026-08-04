import * as React from "react";

import {
  V2ActionButton,
  V2_DEFAULT_DIRECTORY,
  V2_INPUT_STYLE,
  V2_PATH,
  V2PageLayout,
} from "./v2-layout";

type V2PageModule = typeof import("./v2");

let v2PagePromise: Promise<V2PageModule> | null = null;

export function loadV2Page(): Promise<V2PageModule> {
  v2PagePromise ??= import("./v2");
  return v2PagePromise;
}

export function preloadV2Page(pathname: string): void {
  if (pathname === V2_PATH) {
    void loadV2Page();
  }
}

const DeferredV2Page = React.lazy(() =>
  loadV2Page().then((module) => ({ default: module.V2Page })),
);

export function V2LoadingPage(): React.ReactElement {
  return (
    <V2PageLayout
      busy
      endpoint="Resolving…"
      directoryControl={
        <input value={V2_DEFAULT_DIRECTORY} readOnly style={V2_INPUT_STYLE} spellCheck={false} />
      }
      actions={
        <>
          <V2ActionButton disabled>Open</V2ActionButton>
          <V2ActionButton disabled>Trust</V2ActionButton>
        </>
      }
      log={<div style={{ opacity: 0.5, fontSize: 13 }}>No calls yet.</div>}
    />
  );
}

export function V2RouteSurface(): React.ReactElement {
  return (
    <React.Suspense fallback={<V2LoadingPage />}>
      <DeferredV2Page />
    </React.Suspense>
  );
}

export { V2_PATH };
