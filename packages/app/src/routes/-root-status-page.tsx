import type { ReactNode } from "react";

import { Button } from "@honk/multikit/button";

export interface RootStatusAction {
  readonly label: ReactNode;
  readonly onClick: () => void;
}

export function RootStatusPage(props: {
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly details?: string;
  readonly actions?: readonly RootStatusAction[];
}) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-(--honk-chat-surface-background) p-6 text-foreground">
      <div className="flex w-full max-w-lg flex-col items-center gap-2 text-center">
        <h2 className="mb-0 text-base font-medium text-foreground">{props.title}</h2>
        <p className="text-sm text-muted-foreground">{props.description}</p>
        {props.details ? (
          <pre className="mt-1 max-h-48 w-full overflow-auto whitespace-pre-wrap rounded-honk-card bg-honk-bg-tertiary px-3 py-2 text-left font-mono text-detail text-honk-fg-tertiary">
            {props.details}
          </pre>
        ) : null}
        {props.actions && props.actions.length > 0 ? (
          <div className="flex items-center gap-2">
            {props.actions.map((action) => (
              <Button
                key={String(action.label)}
                type="button"
                size="sm"
                variant="ghost"
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
