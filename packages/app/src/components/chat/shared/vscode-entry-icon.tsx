import { useState } from "react";
import { getVscodeIconUrlForEntry } from "./vscode-entry-icons";
import { IconFileBend, IconFolder1 } from "central-icons";
import { cn } from "~/lib/utils";

export function VscodeEntryIcon(props: {
  pathValue: string;
  kind: "file" | "directory";
  theme: "light" | "dark";
  className?: string;
}) {
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const iconUrl = getVscodeIconUrlForEntry(props.pathValue, props.kind, props.theme);
  const failed = failedIconUrl === iconUrl;

  if (failed) {
    return props.kind === "directory" ? (
      <IconFolder1 className={cn("size-4 text-muted-foreground/80", props.className)} />
    ) : (
      <IconFileBend className={cn("size-4 text-muted-foreground/80", props.className)} />
    );
  }

  return (
    <img
      src={iconUrl}
      alt=""
      aria-hidden="true"
      className={cn("size-4 shrink-0", props.className)}
      loading="lazy"
      onError={() => setFailedIconUrl(iconUrl)}
    />
  );
}
