import { CursorComposerIntentsFeed } from "~/components/shell/debug/cursor-composer-intents-feed";
import { CursorNativeStyle } from "~/components/shell/debug/cursor-native-previews";

export function DebugGalleryPage() {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable]">
      <CursorNativeStyle />
      <main
        className="agent-panel mx-auto flex min-h-0 w-full max-w-full flex-1 flex-col bg-[var(--multi-chat-surface-background)] outline-hidden"
        data-component="agent-panel"
      >
        <div
          aria-hidden
          className="pointer-events-none h-(--multi-header-height) shrink-0 select-none"
        />
        <div className="mx-auto flex min-h-0 w-full max-w-[43.875rem] shrink-0 flex-col px-4 py-6 md:px-8">
          <header className="mb-6 space-y-1 font-multi">
            <p className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
              Dev / debug intents
            </p>
            <h1 className="text-[17px] leading-[22px] font-semibold text-foreground">
              Composer UI (Cursor workbench classes)
            </h1>
            <p className="text-detail/[1.45] text-muted-foreground">
              Static transcript mock: shipped{" "}
              <code className="font-multi-mono text-detail">ui-*</code> hooks from{" "}
              <code className="font-multi-mono text-detail">workbench.desktop.main</code>, scoped
              under <code className="font-multi-mono text-detail">[data-cursor-preview]</code>.
            </p>
          </header>
          <div
            className="composer-messages-container flex min-h-0 min-w-0 flex-1 flex-col"
            data-composer-messages
          >
            <CursorComposerIntentsFeed />
          </div>
        </div>
      </main>
    </div>
  );
}
