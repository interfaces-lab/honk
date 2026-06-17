"use client";

import { IconConsole, IconCrossMediumDefault } from "central-icons";

import type { TerminalSessionEntry } from "~/stores/shell-panels-store";
import { cn } from "~/lib/utils";

export function TerminalRail(props: {
  sessions: TerminalSessionEntry[];
  activeId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col gap-px overscroll-contain px-2 pb-3 pt-2 overflow-y-auto">
        {props.sessions.map((session) => {
          const active = session.id === props.activeId;
          return (
            <div
              key={session.id}
              className={cn(
                "group flex min-h-6 items-center gap-2 rounded-honk-control px-1.5 py-1 text-body transition-colors",
                active
                  ? "bg-honk-bg-tertiary text-foreground"
                  : "text-muted-foreground hover:bg-honk-bg-quaternary hover:text-foreground",
              )}
            >
              <button
                type="button"
                onClick={() => props.onActivate(session.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <IconConsole className="size-4 shrink-0 opacity-60" />
                <span className="min-w-0 truncate">{session.label}</span>
              </button>
              <button
                type="button"
                aria-label={`Close ${session.label}`}
                onClick={() => props.onClose(session.id)}
                className="flex size-4 shrink-0 items-center justify-center rounded-sm text-honk-fg-tertiary opacity-0 transition-opacity group-hover:opacity-100 hover:text-honk-fg-primary focus-visible:opacity-100"
              >
                <IconCrossMediumDefault className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
