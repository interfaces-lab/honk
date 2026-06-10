import { IconFiles } from "central-icons";
import { Button } from "@multi/multikit/button";

export function EmptyFilePreview(props: { onOpenFile: () => void }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center px-4 py-8 text-center">
      <Button type="button" onClick={props.onOpenFile} variant="outline">
        <IconFiles className="size-4" />
        Open File
      </Button>
    </div>
  );
}
