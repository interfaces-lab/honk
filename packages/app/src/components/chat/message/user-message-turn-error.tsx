import { IconExclamationCircle } from "central-icons";

export function UserMessageTurnError({ message }: { message: string }) {
  return (
    <p
      className="m-0 flex items-start gap-1 text-caption text-destructive line-clamp-3"
      title={message}
    >
      <IconExclamationCircle className="mt-px size-3 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{message}</span>
    </p>
  );
}
