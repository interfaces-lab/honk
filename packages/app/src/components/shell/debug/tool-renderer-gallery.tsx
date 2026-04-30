import { CursorNativePreview } from "~/components/shell/debug/cursor-native-previews";

const tools = [
  "ShellToolCallHeaderActions",
  "ShellToolCallFull",
  "ShellToolCallCompleted",
  "FileToolCardRead",
  "FileToolCardEdit",
  "AgentPanelToolStack",
  "McpToolCallBlock",
  "ChatToolInvocation",
  "ToolCardShell",
] as const;

export function ToolRendererGallery() {
  return (
    <section className="scroll-mt-[4.5rem] font-multi space-y-6" id="debug-tool-renderers">
      <div className="space-y-1">
        <h2 className="text-[17px] leading-[22px] font-semibold text-foreground">
          Cursor tool components
        </h2>
        <p className="text-detail/[1.45] text-muted-foreground">
          Structural mocks using shipped workbench class names for every tool call surface.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {tools.map((title) => (
          <div key={title} className="min-w-0 space-y-2">
            <div className="text-caption font-medium text-muted-foreground">{title}</div>
            <div
              data-cursor-preview
              className="overflow-hidden rounded-multi-card border border-multi-border/35 bg-background/20 p-3"
            >
              <CursorNativePreview title={title} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
