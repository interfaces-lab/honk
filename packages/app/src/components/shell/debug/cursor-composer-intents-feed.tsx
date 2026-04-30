import type { ReactNode } from "react";

import { CursorComposerThinkingSection } from "~/components/shell/debug/cursor-composer-thinking";
import {
  CursorPreviewFileToolEditComposerFeed,
  CursorPreviewShellToolCallCollapsed,
  CursorPreviewShellToolCallFull,
} from "~/components/shell/debug/cursor-native-previews";

function ToolShell(props: { children: ReactNode }) {
  return (
    <div className="agent-panel-meta-agent-chat__row--tool-call">
      <div className="agent-panel-meta-agent-chat__tool-call-row">{props.children}</div>
    </div>
  );
}

export function CursorComposerIntentsFeed() {
  return (
    <div
      data-cursor-preview
      className="flex min-w-0 flex-col gap-3 px-1 py-2 font-multi [font-synthesis:none]"
    >
      <p className="cursor-composer-explored-facsimile">Explored 1 search</p>
      <p className="cursor-composer-explored-facsimile">Explored 1 file, 1 search</p>
      <div className="cursor-composer-todo-facsimile">
        <span className="cursor-composer-todo-facsimile__check" aria-hidden>
          &#10003;
        </span>
        <span>Started to-do — Run fmt, lint, typecheck, and targeted web tests</span>
      </div>
      <div className="cursor-composer-markdown-facsimile">
        I&apos;ll run the repo formatters and checks, then run the web package typecheck and the
        debug gallery test. If anything fails, I&apos;ll fix and re-run. Relevant logic lives in{" "}
        <code>session-logic</code> and <code>chat-timeline</code>.
      </div>
      <CursorComposerThinkingSection />
      <ToolShell>
        <CursorPreviewShellToolCallFull
          description="Format repository files"
          summary="cd, pnpm"
          command={
            <code className="ui-shell-tool-call__command">
              <span className="ui-shell-tool-call__prompt">$ </span>
              <span className="ui-shell-tool-call__token--command">cd</span>
              <span className="ui-shell-tool-call__token--whitespace"> </span>
              <span className="ui-shell-tool-call__token--text">
                /Users/workgyver/Developer/c-glass
              </span>
              <span className="ui-shell-tool-call__token--whitespace"> </span>
              <span className="ui-shell-tool-call__token--operator">{"&&"}</span>
              <span className="ui-shell-tool-call__token--whitespace"> </span>
              <span className="ui-shell-tool-call__token--command">pnpm</span>
              <span className="ui-shell-tool-call__token--whitespace"> </span>
              <span className="ui-shell-tool-call__token--text">run</span>
              <span className="ui-shell-tool-call__token--whitespace"> </span>
              <span className="ui-shell-tool-call__token--text">fmt</span>
            </code>
          }
          output={
            "> @glass/monorepo@ fmt /Users/workgyver/Developer/c-glass\nFinished formatting in 120ms."
          }
        />
      </ToolShell>
      <ToolShell>
        <CursorPreviewShellToolCallCollapsed
          description="Run repository lint checks"
          summary="cd, pnpm"
        />
      </ToolShell>
      <ToolShell>
        <CursorPreviewShellToolCallCollapsed
          description="Run repository typecheck"
          summary="pnpm run typecheck"
        />
      </ToolShell>
      <ToolShell>
        <CursorPreviewShellToolCallCollapsed
          description="Typecheck web package only"
          summary="pnpm exec tsc --noEmit -p packages/app"
        />
      </ToolShell>
      <ToolShell>
        <CursorPreviewFileToolEditComposerFeed />
      </ToolShell>
      <p className="cursor-composer-footer-facsimile">Chat context summarized.</p>
    </div>
  );
}
