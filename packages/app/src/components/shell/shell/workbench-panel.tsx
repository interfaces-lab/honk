"use client";

import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

export function WorkbenchPanel(props: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-(--multi-workbench-editor-surface-background) after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-10 after:w-px after:bg-multi-stroke-quaternary",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

export function PlaceholderPanel(props: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      <p className="text-body font-medium text-foreground/85">{props.label}</p>
      <p className="max-w-72 text-detail text-muted-foreground/72">
        Coming soon. This tab is not yet available.
      </p>
    </div>
  );
}
