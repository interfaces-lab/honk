import { IconFiles } from "central-icons";

export function EmptyFilePreview(props: { onOpenFile: () => void }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center px-4 py-8 text-center">
      <button
        type="button"
        onClick={props.onOpenFile}
        className="flex h-7 items-center gap-1.5 rounded-multi-control border border-multi-workbench-panel-border-muted bg-(--multi-workbench-card-background) px-2.5 text-body font-medium text-multi-fg-primary hover:bg-(--multi-workbench-toolbar-hover-background)"
      >
        <IconFiles className="size-4" />
        Open File
      </button>
    </div>
  );
}
