import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

export function RootShell(props: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "agent-panel__root relative flex min-h-0 min-w-0 flex-1 flex-col bg-multi-editor",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}
