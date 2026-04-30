"use client";

import type { ReactNode } from "react";

export function WorkbenchPanel(props: { children: ReactNode }) {
  return <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">{props.children}</div>;
}

export function PlaceholderPanel(props: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      <p className="text-body/[1.4] font-medium text-foreground/85">{props.label}</p>
      <p className="max-w-[18rem] text-detail/[1.45] text-muted-foreground/72">
        Coming soon. This tab is not yet available.
      </p>
    </div>
  );
}
