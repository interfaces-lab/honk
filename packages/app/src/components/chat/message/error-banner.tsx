import { Button } from "@honk/honkkit/button";
import { StatusNotice } from "@honk/honkkit/marker";
import { IconCrossMediumDefault } from "central-icons";

export function ThreadErrorBanner({
  error,
  onDismiss,
}: {
  error: string | null;
  onDismiss?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="mx-auto max-w-3xl pt-3">
      <StatusNotice
        className="rounded-md border border-destructive/25 bg-popover/95 px-2 py-1.5 shadow-sm backdrop-blur-xl"
        message={error}
        action={
          onDismiss ? (
            <Button
              aria-label="Dismiss error"
              className="-my-0.5 size-7 shrink-0 text-destructive/60 hover:text-destructive"
              size="icon-sm"
              variant="ghost"
              onClick={onDismiss}
            >
              <IconCrossMediumDefault className="size-3.5" />
            </Button>
          ) : null
        }
      />
    </div>
  );
}
