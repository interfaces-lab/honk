import { IconLoader } from "central-icons";
import { cn } from "./utils";

function Spinner({ className, ...props }: React.ComponentProps<typeof IconLoader>) {
  return (
    <IconLoader
      aria-label="Loading"
      className={cn("animate-spin", className)}
      role="status"
      {...props}
    />
  );
}

export { Spinner };
