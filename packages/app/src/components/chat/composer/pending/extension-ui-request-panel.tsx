import { type DesktopExtensionUiRequest } from "@multi/contracts";
import { Button } from "@multi/ui/button";
import { Input } from "@multi/ui/input";
import { memo, useState } from "react";

interface ComposerPendingExtensionUiRequestPanelProps {
  readonly request: DesktopExtensionUiRequest | null;
  readonly pendingCount: number;
  readonly isResponding: boolean;
  readonly onRespond: (request: DesktopExtensionUiRequest, value: unknown) => void;
}

export const ComposerPendingExtensionUiRequestPanel = memo(
  function ComposerPendingExtensionUiRequestPanel({
    request,
    pendingCount,
    isResponding,
    onRespond,
  }: ComposerPendingExtensionUiRequestPanelProps) {
    const [draftValue, setDraftValue] = useState("");

    if (!request) {
      return null;
    }

    return (
      <div className="px-4 py-3.5 sm:px-5 sm:py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm tracking-[0.2em] uppercase">Pending request</span>
          <span className="text-sm font-medium">{request.title}</span>
          {pendingCount > 1 ? (
            <span className="text-xs text-muted-foreground">1/{pendingCount}</span>
          ) : null}
        </div>
        {request.message ? (
          <p className="mt-2 text-sm text-muted-foreground">{request.message}</p>
        ) : null}
        {request.kind === "select" ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(request.options ?? []).map((option) => (
              <Button
                key={option}
                size="sm"
                variant="outline"
                disabled={isResponding}
                onClick={() => onRespond(request, option)}
              >
                {option}
              </Button>
            ))}
          </div>
        ) : null}
        {request.kind === "confirm" ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Button size="sm" disabled={isResponding} onClick={() => onRespond(request, true)}>
              Confirm
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isResponding}
              onClick={() => onRespond(request, false)}
            >
              Cancel
            </Button>
          </div>
        ) : null}
        {request.kind === "input" || request.kind === "editor" || request.kind === "custom" ? (
          <div className="mt-3 flex gap-2">
            <Input
              size="sm"
              value={draftValue}
              placeholder={request.placeholder}
              disabled={isResponding}
              onChange={(event) => setDraftValue(event.target.value)}
            />
            <Button size="sm" disabled={isResponding} onClick={() => onRespond(request, draftValue)}>
              Send
            </Button>
          </div>
        ) : null}
      </div>
    );
  },
);
