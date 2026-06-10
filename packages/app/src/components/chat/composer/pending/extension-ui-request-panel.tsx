import { type DesktopExtensionUiRequest } from "@multi/contracts";
import { Button } from "@multi/multikit/button";
import { Input } from "@multi/multikit/input";
import { useState, type KeyboardEvent } from "react";

interface ComposerPendingExtensionUiRequestPanelProps {
  readonly request: DesktopExtensionUiRequest | null;
  readonly pendingCount: number;
  readonly isResponding: boolean;
  readonly onRespond: (request: DesktopExtensionUiRequest, value: unknown) => void;
}

export interface PendingExtensionUiRequestResponseAction {
  readonly label: string;
  readonly value: unknown;
}

export function pendingExtensionUiRequestResponseActions(
  request: DesktopExtensionUiRequest,
  draftValue: string,
): readonly PendingExtensionUiRequestResponseAction[] {
  switch (request.kind) {
    case "select":
      return (request.options ?? []).map((option) => ({
        label: option,
        value: option,
      }));
    case "confirm":
      return [
        { label: "Confirm", value: true },
        { label: "Cancel", value: false },
      ];
    case "input":
    case "editor":
    case "custom":
      return [{ label: "Send", value: draftValue }];
    default:
      return [];
  }
}

function requestKindLabel(kind: DesktopExtensionUiRequest["kind"]): string {
  switch (kind) {
    case "select":
      return "Select an option";
    case "confirm":
      return "Confirm";
    case "input":
      return "Your answer";
    case "editor":
      return "Editor";
    case "custom":
      return "Request";
  }
}

export function ComposerPendingExtensionUiRequestPanel({
  request,
  pendingCount,
  isResponding,
  onRespond,
}: ComposerPendingExtensionUiRequestPanelProps) {
  const [draftValue, setDraftValue] = useState("");

  if (!request) {
    return null;
  }
  const responseActions = pendingExtensionUiRequestResponseActions(request, draftValue);
  const isOptionsRequest = request.kind === "select" || request.kind === "confirm";

  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isOptionsRequest || isResponding) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return;
    }
    if (
      target instanceof HTMLElement &&
      target.closest('[contenteditable]:not([contenteditable="false"])')
    ) {
      return;
    }
    const digit = Number.parseInt(event.key, 10);
    if (Number.isNaN(digit) || digit < 1 || digit > 9) return;
    const action = responseActions[digit - 1];
    if (!action) return;
    event.preventDefault();
    onRespond(request, action.value);
  };

  return (
    <div className="px-4 py-3 sm:px-5" onKeyDownCapture={handleKeyDownCapture}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {pendingCount > 1 ? (
            <span className="flex h-5 shrink-0 items-center rounded-multi-control bg-multi-bg-tertiary px-1.5 text-caption font-medium tabular-nums text-multi-fg-tertiary">
              1/{pendingCount}
            </span>
          ) : null}
          <span className="min-w-0 truncate text-detail font-semibold text-multi-fg-tertiary uppercase">
            {requestKindLabel(request.kind)}
          </span>
        </div>
      </div>
      <p className="mt-1.5 select-text text-body text-multi-fg-primary">{request.title}</p>
      {request.message ? (
        <p className="mt-1 select-text text-caption text-multi-fg-tertiary">{request.message}</p>
      ) : null}
      {isOptionsRequest ? (
        <div className="mt-3 grid gap-1" role="radiogroup" aria-label={request.title}>
          {responseActions.map((action, index) => {
            const shortcutKey = index < 9 ? index + 1 : null;
            return (
              <Button
                key={action.label}
                type="button"
                variant="ghost"
                disabled={isResponding}
                role="radio"
                aria-checked={false}
                onClick={() => onRespond(request, action.value)}
                className={[
                  "group flex h-auto min-h-9 w-full justify-start whitespace-normal rounded-multi-control border-transparent bg-multi-bg-quaternary/60 px-2.5 py-2 text-left text-multi-fg-secondary transition-colors duration-100",
                  "hover:border-multi-stroke-tertiary hover:bg-multi-bg-tertiary hover:text-multi-fg-primary",
                  isResponding ? "cursor-not-allowed opacity-50" : "",
                ].join(" ")}
              >
                {shortcutKey !== null ? (
                  <kbd className="flex size-5 shrink-0 items-center justify-center rounded-multi-control bg-multi-bg-tertiary text-detail font-medium tabular-nums text-multi-fg-quaternary transition-colors duration-100 group-hover:text-multi-fg-tertiary">
                    {shortcutKey}
                  </kbd>
                ) : null}
                <span className="min-w-0 flex-1 text-body font-medium">{action.label}</span>
              </Button>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Input
            size="sm"
            value={draftValue}
            placeholder={request.placeholder ?? "Type your answer"}
            disabled={isResponding}
            autoFocus
            onChange={(event) => setDraftValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || isResponding) return;
              event.preventDefault();
              onRespond(request, draftValue);
            }}
          />
          <Button
            size="sm"
            disabled={isResponding}
            onClick={() => onRespond(request, responseActions[0]?.value ?? "")}
          >
            {responseActions[0]?.label ?? "Send"}
          </Button>
        </div>
      )}
    </div>
  );
}
