import { Alert, AlertAction, AlertDescription } from "@multi/ui/alert";
import { IconCrossMediumDefault, IconExclamationCircle } from "central-icons";

export function ThreadErrorBanner({
  error,
  onDismiss,
}: {
  error: string | null;
  onDismiss?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="pt-3 mx-auto max-w-3xl">
      <Alert variant="error">
        <IconExclamationCircle />
        <AlertDescription className="line-clamp-3" title={error}>
          {error}
        </AlertDescription>
        {onDismiss && (
          <AlertAction>
            <button
              type="button"
              aria-label="Dismiss error"
              className="inline-flex size-6 items-center justify-center rounded-md text-destructive/60 transition-colors hover:text-destructive"
              onClick={onDismiss}
            >
              <IconCrossMediumDefault className="size-3.5" />
            </button>
          </AlertAction>
        )}
      </Alert>
    </div>
  );
}
