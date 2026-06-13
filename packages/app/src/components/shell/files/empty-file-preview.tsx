import { IconFiles } from "central-icons";
import { Button } from "@honk/honkkit/button";

export function EmptyFilePreview(props: { onOpenFile: () => void; label?: string }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center px-4 py-8 text-center">
      <Button type="button" onClick={props.onOpenFile} variant="outline">
        <IconFiles className="size-4" />
        {props.label ?? "Open File"}
      </Button>
    </div>
  );
}
