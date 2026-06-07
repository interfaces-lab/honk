import { Alert, AlertAction, AlertDescription } from "@multi/multikit/alert";
import { Button } from "@multi/multikit/button";
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
            <Button
              aria-label="Dismiss error"
              className="text-destructive/60 hover:text-destructive"
              size="icon-sm"
              variant="ghost"
              onClick={onDismiss}
            >
              <IconCrossMediumDefault className="size-3.5" />
            </Button>
          </AlertAction>
        )}
      </Alert>
    </div>
  );
}
