import type { UiAskReply, UiAskState } from "~/lib/ui-session-types";
import {
  IconCheckmark1Small,
  IconChevronLeft,
  IconChevronRight,
  IconCrossSmall,
} from "central-icons";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollArea } from "@multi/ui/scroll-area";
import { cn } from "~/lib/utils";

interface Props {
  state: UiAskState;
  onReply: (reply: UiAskReply) => void;
}

const vacant: string[] = [];

const MotionCard = motion.create("div");

function ShortcutBadge(props: { char: string }) {
  return (
    <kbd className="flex size-5 shrink-0 items-center justify-center rounded-sm border border-multi-border/60 bg-multi-hover/40 text-[10px] leading-none font-medium text-muted-foreground/85">
      {props.char.toUpperCase()}
    </kbd>
  );
}

function PickBadge(props: { text: string }) {
  return (
    <span className="rounded-sm border border-primary/30 bg-primary/[0.08] px-1 py-px text-[10px] leading-[14px] font-medium text-primary/88">
      {props.text}
    </span>
  );
}

function OptRow(props: {
  label: string;
  shortcut?: string;
  checked: boolean;
  recommended?: boolean;
  multi?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onChange}
      className={cn(
        "group flex w-full items-center gap-2 rounded-sm border px-2 py-1.5 text-left transition-colors",
        props.checked
          ? "border-primary/60 bg-primary/[0.06]"
          : "border-multi-border/50 bg-transparent hover:border-multi-border/80 hover:bg-multi-hover/30",
      )}
    >
      {props.shortcut ? <ShortcutBadge char={props.shortcut} /> : null}
      <span
        className={cn(
          "flex-1 text-[12px] leading-[16px]",
          props.checked ? "text-foreground" : "text-foreground/80",
        )}
      >
        {props.label}
      </span>
      {props.recommended ? <PickBadge text="Recommended" /> : null}
      <span
        className={cn(
          "flex size-3.5 shrink-0 items-center justify-center border transition-colors",
          props.multi ? "rounded-[3px]" : "rounded-full",
          props.checked
            ? "border-primary bg-primary"
            : "border-muted-foreground/40 group-hover:border-muted-foreground/60",
        )}
      >
        {props.checked ? (
          props.multi ? (
            <IconCheckmark1Small className="size-2.5 text-primary-foreground" />
          ) : (
            <span className="size-1 rounded-full bg-primary-foreground" />
          )
        ) : null}
      </span>
    </button>
  );
}

function Pagination(props: {
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] leading-[14px] text-muted-foreground/70">
      <button
        type="button"
        onClick={props.onPrev}
        disabled={props.current <= 1}
        className="flex size-5 items-center justify-center rounded-sm text-muted-foreground/55 transition-colors hover:bg-multi-hover hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
        aria-label="Previous question"
      >
        <IconChevronLeft className="size-3" />
      </button>
      <span className="tabular-nums">
        {props.current} of {props.total}
      </span>
      <button
        type="button"
        onClick={props.onNext}
        disabled={props.current >= props.total}
        className="flex size-5 items-center justify-center rounded-sm text-muted-foreground/55 transition-colors hover:bg-multi-hover hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
        aria-label="Next question"
      >
        <IconChevronRight className="size-3" />
      </button>
    </div>
  );
}

export function AskTool(props: Props) {
  const q = props.state.questions[props.state.current - 1];
  const baseVals = useMemo(() => {
    if (!q) return vacant;
    return props.state.values[q.id] ?? vacant;
  }, [q, props.state.values]);
  const baseCustom = q ? (props.state.custom[q.id] ?? "") : "";
  const other = q?.options.find((item) => item.other) ?? null;
  const picks = useMemo(() => q?.options.filter((item) => !item.other) ?? [], [q]);
  const [vals, setVals] = useState(baseVals);
  const [custom, setCustom] = useState(baseCustom);
  const [mode, setMode] = useState<"options" | "custom">(baseCustom ? "custom" : "options");
  const valsRef = useRef(vals);
  const customRef = useRef(custom);
  valsRef.current = vals;
  customRef.current = custom;

  useEffect(() => {
    setVals(baseVals);
    setCustom(baseCustom);
    setMode(baseCustom ? "custom" : "options");
  }, [baseCustom, baseVals, q?.id]);

  const canGo = vals.length > 0 || custom.trim().length > 0;
  const canBack = props.state.current > 1;
  const canNext = props.state.current < props.state.questions.length;

  const toggle = useCallback(
    (id: string) => {
      if (!q) return;
      if (!q.multi) {
        setVals([id]);
        setMode("options");
        return;
      }
      setVals((cur) => {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return [...next];
      });
      setMode("options");
    },
    [q],
  );

  const reply = useCallback(
    (type: UiAskReply["type"]) => {
      if (!q) return;
      if (type === "abort") {
        props.onReply({ type });
        return;
      }
      if (type === "skip") {
        props.onReply({ type, questionId: q.id });
        return;
      }
      props.onReply({
        type,
        questionId: q.id,
        values: valsRef.current,
        ...(mode === "custom" && customRef.current.trim() ? { custom: customRef.current } : {}),
      });
    },
    [mode, props, q],
  );

  useEffect(() => {
    if (!q) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLTextAreaElement) {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canGo) {
          event.preventDefault();
          reply("next");
        }
        if (event.key === "Escape") {
          event.preventDefault();
          reply("abort");
        }
        return;
      }
      if (event.target instanceof HTMLInputElement) return;

      const key = event.key.toLowerCase();
      const hit = picks.find((item, i) => (item.shortcut ?? String.fromCharCode(97 + i)) === key);
      if (hit) {
        event.preventDefault();
        toggle(hit.id);
        return;
      }

      if (other && (other.shortcut ?? "i") === key) {
        event.preventDefault();
        setMode("custom");
        return;
      }

      if (event.key === "Enter" && canGo) {
        event.preventDefault();
        reply("next");
        return;
      }
      if (event.key === "Backspace" && canBack && !canGo) {
        event.preventDefault();
        reply("back");
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        reply("abort");
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canBack, canGo, other, picks, q, reply, toggle]);

  const count = useMemo(() => vals.length + (custom.trim() ? 1 : 0), [custom, vals.length]);

  if (!q) return null;

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-full z-50 mb-2 px-4 md:px-6">
      <MotionCard
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto w-full max-w-xl overflow-hidden rounded-multi-card border border-multi-stroke-tertiary bg-multi-bubble/98 shadow-multi-popup backdrop-blur-xl"
      >
        <div className="flex items-center justify-between border-b border-multi-border/30 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <h3 className="text-[12px] leading-[16px] font-semibold text-foreground">Questions</h3>
            {count > 0 ? <PickBadge text={`${count} selected`} /> : null}
          </div>
          <Pagination
            current={props.state.current}
            total={props.state.questions.length}
            onPrev={() => reply("back")}
            onNext={() => {
              if (canGo) reply("next");
            }}
          />
        </div>

        <ScrollArea scrollFade className="max-h-[min(60vh,480px)]">
          <div className="p-2">
            <AnimatePresence mode="wait">
              <motion.div
                key={q.id}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.15 }}
                className="flex flex-col gap-2"
              >
                <p className="px-1 text-[12px] leading-[16px] font-medium text-foreground">
                  {q.text}
                </p>
                <div className="flex flex-col gap-0.5">
                  {picks.map((item) => (
                    <OptRow
                      key={item.id}
                      label={item.label}
                      {...(item.shortcut ? { shortcut: item.shortcut } : {})}
                      checked={vals.includes(item.id)}
                      {...(item.recommended ? { recommended: true } : {})}
                      {...(q.multi ? { multi: true } : {})}
                      onChange={() => toggle(item.id)}
                    />
                  ))}
                  {other ? (
                    <button
                      type="button"
                      onClick={() => setMode((cur) => (cur === "custom" ? "options" : "custom"))}
                      className={cn(
                        "flex items-center gap-2 rounded-sm border px-2 py-1.5 text-left transition-all",
                        mode === "custom"
                          ? "border-primary/60 bg-primary/[0.06]"
                          : "border-dashed border-multi-border/50 bg-transparent hover:border-multi-border/80 hover:bg-multi-hover/30",
                      )}
                    >
                      {other.shortcut ? <ShortcutBadge char={other.shortcut} /> : null}
                      <span className="flex-1 text-[12px] leading-[16px] text-foreground/82">
                        {other.label}
                      </span>
                      {custom.trim() ? <PickBadge text="Custom" /> : null}
                    </button>
                  ) : null}
                </div>
                {mode === "custom" ? (
                  <div className="rounded-sm border border-multi-border/50 bg-multi-hover/18 p-2">
                    <div className="mb-1.5 flex items-center justify-between gap-1.5">
                      <span className="text-[11px] leading-[14px] font-medium text-foreground/86">
                        Custom answer
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setCustom("");
                          setMode("options");
                        }}
                        className="flex size-5 items-center justify-center rounded-sm text-muted-foreground/62 transition-colors hover:bg-multi-hover hover:text-foreground"
                        aria-label="Close custom answer"
                      >
                        <IconCrossSmall className="size-3" />
                      </button>
                    </div>
                    <textarea
                      value={custom}
                      onChange={(event) => setCustom(event.target.value)}
                      placeholder="Type your answer…"
                      rows={3}
                      className="w-full resize-none rounded-sm border border-multi-border/50 bg-transparent px-2 py-1.5 text-[12px] leading-[16px] text-foreground outline-hidden placeholder:text-muted-foreground/60"
                    />
                    <p className="mt-1.5 text-[11px] leading-[14px] text-muted-foreground/68">
                      Press{" "}
                      <kbd className="rounded-sm bg-multi-hover/60 px-1 py-px text-[10px]">
                        Ctrl+Enter
                      </kbd>{" "}
                      to continue.
                    </p>
                  </div>
                ) : null}
              </motion.div>
            </AnimatePresence>
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between border-t border-multi-border/30 px-2 py-1.5">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => reply("abort")}
              className="rounded-sm px-2 py-1 text-[11px] leading-[14px] text-muted-foreground transition-colors hover:bg-multi-hover hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => reply("skip")}
              className="rounded-sm px-2 py-1 text-[11px] leading-[14px] text-muted-foreground transition-colors hover:bg-multi-hover hover:text-foreground"
            >
              Skip
            </button>
          </div>
          <div className="flex items-center gap-1">
            {canBack ? (
              <button
                type="button"
                onClick={() => reply("back")}
                className="rounded-sm px-2 py-1 text-[11px] leading-[14px] text-muted-foreground transition-colors hover:bg-multi-hover hover:text-foreground"
              >
                Back
              </button>
            ) : null}
            <button
              type="button"
              disabled={!canGo}
              onClick={() => reply("next")}
              className="flex items-center gap-1.5 rounded-sm bg-primary px-2.5 py-1 text-[11px] leading-[14px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {canNext ? "Next" : "Done"}
              <kbd className="hidden rounded-sm bg-primary-foreground/20 px-1 py-px text-[10px] font-medium text-primary-foreground/90 md:inline">
                ↵
              </kbd>
            </button>
          </div>
        </div>
      </MotionCard>
    </div>
  );
}
