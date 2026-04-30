// @ts-nocheck
"use client";

import { useEffect, useRef, useState } from "react";

import { Collapsible } from "@multi/ui/collapsible";
import { cn } from "~/lib/utils";

function Chevron(props: { open: boolean }) {
  return (
    <span
      className="cursor-composer-thinking__chevron"
      data-open={props.open ? "true" : "false"}
      aria-hidden
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M5.3 13.3l.7.7 5-5-5-5-.7.7L9.6 9z" />
      </svg>
    </span>
  );
}

/** Activity log lines + Thinking collapsible (scroll clip, bottom blur, demo shimmer). */
export function CursorComposerThinkingSection() {
  const [open, setOpen] = useState(true);
  const [streaming, setStreaming] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setStreaming(false), 3400);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const sync = () => {
      if (!open) {
        setFade(false);
        return;
      }
      const { scrollTop, scrollHeight, clientHeight } = el;
      const overflow = scrollHeight > clientHeight + 2;
      const notAtEnd = scrollTop + clientHeight < scrollHeight - 6;
      setFade(overflow && notAtEnd);
    };

    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", sync);
      ro.disconnect();
    };
  }, [open]);

  return (
    <div className="flex flex-col gap-2">
      <p className="cursor-composer-activity-log">
        <span className="cursor-composer-activity-log__verb">Grepped</span>
        <span className="font-multi-mono text-[11px] text-muted-foreground/90">
          toolBody|Collapsible in packages/app/src/components/shell/chat/rows.tsx
        </span>
      </p>
      <p className="cursor-composer-activity-log">
        <span className="cursor-composer-activity-log__verb">Thought</span>
        for 8s
      </p>
      <p className="cursor-composer-activity-log">
        <span className="cursor-composer-activity-log__verb">Read</span>
        <span className="font-multi-mono text-[11px] text-muted-foreground/90">
          runtime.ts L1–60
        </span>
      </p>

      <div className="agent-panel-meta-agent-chat__row agent-panel-meta-agent-chat__row--assistant">
        <div className="agent-panel-meta-agent-chat__message-entry">
          <Collapsible.Root open={open} onOpenChange={setOpen}>
            <Collapsible.Trigger
              className={cn(
                "cursor-composer-thinking__trigger",
                streaming && "cursor-composer-thinking__trigger--shimmer",
              )}
            >
              <Chevron open={open} />
              <span className="min-w-0 flex-1">Thinking</span>
            </Collapsible.Trigger>
            <Collapsible.Panel className="cursor-composer-thinking__panel">
              <div className="agent-panel-meta-agent-chat__assistant-markdown">
                <div className="ui-meta-agent-assistant-message__body">
                  <div className="cursor-composer-thinking__scroll-clip">
                    <div ref={scrollRef} className="cursor-composer-thinking__scroll">
                      <p className="cursor-composer-thinking__prose">
                        Now I have the full picture of how tool results are folded into{" "}
                        <code>toolResult</code> and how each session item maps through{" "}
                        <code>toMsg()</code> before it hits the transcript. The important edge is
                        streaming: partial rows must not collapse the layout, so the list renderer
                        keeps a stable key per tool call id.
                      </p>
                      <p className="cursor-composer-thinking__prose">
                        For the debug page we only need a facsimile, but the scroll container should
                        still behave like production: fixed viewport height, overflow scroll, and a
                        fade that hides only when you reach the end (or when content fits).
                      </p>
                      <p className="cursor-composer-thinking__prose">
                        Next I&apos;ll mirror the same token colors Cursor uses for reasoning blocks
                        -- muted body, inline code pills, and a fenced-style block for
                        TypeScript-shaped snippets.
                      </p>
                      <pre className="cursor-composer-thinking__code">
                        <span className="tok-kw">function</span>{" "}
                        <span className="tok-fn">toMsg</span>(<span className="tok-type">item</span>
                        : <span className="tok-type">ChatMessage</span>
                        ): <span className="tok-type">UIMessage</span> {"{"}
                        {"\n"}
                        {"  "}
                        <span className="tok-kw">if</span> (item.role ==={" "}
                        <span className="tok-str">&quot;user&quot;</span>){" "}
                        <span className="tok-kw">return</span> {"{"} kind:{" "}
                        <span className="tok-str">&quot;user&quot;</span>, text: item.text {"}"};
                        {"\n"}
                        {"  "}
                        <span className="tok-kw">if</span> (item.role ==={" "}
                        <span className="tok-str">&quot;assistant&quot;</span>){" "}
                        <span className="tok-kw">return</span> {"{"} kind:{" "}
                        <span className="tok-str">&quot;assistant&quot;</span>, text: item.text{" "}
                        {"}"};{"\n"}
                        {"  "}
                        <span className="tok-kw">return</span> {"{"} kind:{" "}
                        <span className="tok-str">&quot;tool&quot;</span>, payload:{" "}
                        <span className="tok-fn">normalizeToolResult</span>({"item."}
                        <span className="tok-type">toolResult</span>) {"}"};{"\n"}
                        {"}"}
                      </pre>
                      <p className="cursor-composer-thinking__prose">
                        Extra tail content so the clip is obviously scrollable -- scroll to verify
                        the gradient blur tracks the viewport and disappears at the bottom.
                      </p>
                      <ul className="mb-3 list-disc pl-5 text-[13px] leading-relaxed text-muted-foreground/80">
                        <li>ResizeObserver keeps fade in sync with font / theme changes.</li>
                        <li>
                          Shimmer on the header simulates an in-flight reasoning pass (~3.4s demo).
                        </li>
                        <li>
                          <code className="font-multi-mono text-[12px]">mask-image</code> on the
                          fade keeps the blur from eating the full width harshly.
                        </li>
                      </ul>
                    </div>
                    <div
                      className="cursor-composer-thinking__fade-stack"
                      data-visible={fade ? "true" : "false"}
                      aria-hidden
                    >
                      <div className="cursor-composer-thinking__fade cursor-composer-thinking__fade--layer-1" />
                      <div className="cursor-composer-thinking__fade cursor-composer-thinking__fade--layer-2" />
                    </div>
                  </div>
                </div>
              </div>
            </Collapsible.Panel>
          </Collapsible.Root>
        </div>
      </div>
    </div>
  );
}
