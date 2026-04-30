import type { HarnessModelRef, ThinkingLevel } from "~/lib/ui-session-types";
import { Menu } from "@base-ui/react/menu";
import { IconBrain, IconCheckmark1Small, IconChevronRight } from "central-icons";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Skeleton } from "@multi/ui/skeleton";
import { usePretextOneLine } from "~/hooks/use-composer-pretext-one-line";
import {
  displayModelName,
  displayProviderName,
  filterRuntimeModels,
  type RuntimeModelItem,
} from "~/lib/runtime-models";
import { cn } from "~/lib/utils";

function PretextOneLine(props: {
  text: string;
  className?: string;
  fontPx?: number;
  lineHeightPx?: number;
}) {
  const { ref, shown, fallback } = usePretextOneLine({
    text: props.text,
    ...(props.fontPx !== undefined ? { fontPx: props.fontPx } : {}),
    ...(props.lineHeightPx !== undefined ? { lineHeightPx: props.lineHeightPx } : {}),
  });
  return (
    <span ref={ref} className={cn(props.className, fallback && "truncate")}>
      {shown}
    </span>
  );
}

/** `thinkingLevel`: `off` disables extended reasoning; other values set depth. */
const thinkingOptions: { label: string; value: ThinkingLevel }[] = [
  { label: "Off", value: "off" },
  { label: "Minimal", value: "minimal" },
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "Extra High", value: "xhigh" },
];

function thinkingDetailLabel(level: ThinkingLevel) {
  const row = thinkingOptions.find((o) => o.value === level);
  return row?.label ?? level;
}

function clamp(level: ThinkingLevel, xhigh: boolean) {
  if (level === "xhigh" && !xhigh) return "high";
  return level;
}

type ModelPickerSelection = {
  model: HarnessModelRef | null;
  fastMode?: boolean;
  thinkingLevel?: ThinkingLevel;
};

function stopMenuSearchBubbling(e: React.KeyboardEvent) {
  e.stopPropagation();
}

export type ModelPickerHandle = {
  open: () => void;
};

export const ModelPicker = forwardRef<
  ModelPickerHandle,
  {
    items: readonly RuntimeModelItem[];
    selection: ModelPickerSelection;
    disabled?: boolean;
    loading?: boolean;
    status?: "loading" | "ready" | "error";
    variant?: "hero" | "dock" | "settings";
    onSelect: (item: RuntimeModelItem) => void;
    onFastMode?: (on: boolean) => void;
    onThinkingLevel?: (level: ThinkingLevel) => void;
  }
>(function ModelPicker(props, ref) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const list = useMemo(() => filterRuntimeModels(props.items, query), [props.items, query]);
  const cur = useMemo(
    () =>
      props.items.find(
        (item) =>
          item.provider === props.selection.model?.provider &&
          item.id === props.selection.model?.id,
      ),
    [props.items, props.selection.model],
  );
  const xhigh = Boolean(cur?.supportsXhigh);
  const thinkingItems = useMemo(
    () => (xhigh ? thinkingOptions : thinkingOptions.filter((item) => item.value !== "xhigh")),
    [xhigh],
  );

  useEffect(() => {
    if (open) return;
    setQuery("");
  }, [open]);

  // Focus search input when menu opens
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const thinkingValue = clamp(props.selection.thinkingLevel ?? "off", xhigh);
  const fastValue = props.selection.fastMode ? "on" : "off";
  const status = props.status ?? (props.loading ? "loading" : "ready");
  const busy = status === "loading";
  const failed = status === "error";
  const idle = !props.disabled && !busy && !failed && props.items.length > 0;
  const locked = (props.disabled ?? false) || busy || failed;
  const showFast = Boolean(props.onFastMode && cur?.supportsFastMode);
  const showThinking = Boolean(props.onThinkingLevel && cur?.reasoning);

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        if (locked || props.items.length === 0) return;
        if (open) {
          inputRef.current?.focus();
          return;
        }
        const node = triggerRef.current;
        if (!node) {
          setOpen(true);
          return;
        }
        node.focus();
        node.click();
      },
    }),
    [locked, open, props.items.length],
  );

  const triggerLabel = (() => {
    if (cur != null) {
      return displayModelName(cur.name || cur.id);
    }
    if (props.selection.model?.id) {
      return displayModelName(props.selection.model.name ?? props.selection.model.id);
    }
    if (busy) {
      return "Loading models";
    }
    if (failed) {
      return "Models unavailable";
    }
    return "Select model";
  })();

  const side = props.variant === "dock" ? "top" : "bottom";
  const align = props.variant === "settings" ? "start" : "end";
  const settings = props.variant === "settings";

  return (
    <Menu.Root
      open={open}
      onOpenChange={(next) => {
        if (locked) {
          setOpen(false);
          return;
        }
        setOpen(next);
      }}
    >
      <Menu.Trigger
        ref={triggerRef}
        type="button"
        data-size="sm"
        aria-label={`Model: ${triggerLabel}${props.onThinkingLevel ? `, thinking ${thinkingDetailLabel(thinkingValue)}` : ""}${showFast ? `, fast mode ${fastValue}` : ""}`}
        disabled={!idle}
        className={cn(
          "ui-model-picker__trigger inline-flex min-w-0 gap-1.5 rounded-multi-control border text-left text-body outline-none transition-colors focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none",
          settings
            ? "h-auto min-h-6 w-full max-w-full flex-col items-stretch gap-0.5 border-multi-stroke/50 bg-multi-hover/20 py-1 pl-2 pr-1 hover:bg-multi-hover/40"
            : "h-6 max-w-[min(100%,280px)] items-center border-multi-stroke/40 bg-multi-hover/15 pl-2 pr-1.5 hover:border-multi-stroke/60 hover:bg-multi-hover/35",
          cur != null || props.selection.model?.id
            ? "text-foreground/90"
            : "text-muted-foreground/70",
          !idle && "opacity-50",
        )}
      >
        {busy && !props.selection.model?.id ? (
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Skeleton className={cn("h-3 rounded bg-muted/45", settings ? "w-28" : "w-20")} />
            {settings && props.onThinkingLevel ? (
              <Skeleton className="h-2 w-20 rounded bg-muted/35" />
            ) : null}
          </div>
        ) : (
          <>
            <div className={cn("flex min-w-0 items-center gap-1.5", settings && "w-full")}>
              {cur?.reasoning ? (
                <span
                  className="inline-flex shrink-0 items-center text-muted-foreground/70"
                  aria-hidden
                  title="Reasoning model"
                >
                  <IconBrain className="size-3" />
                </span>
              ) : null}
              <span className="min-w-0 flex-1 overflow-hidden">
                <PretextOneLine
                  text={triggerLabel}
                  className={cn(
                    "block w-full min-w-0 text-left text-body",
                    cur != null || props.selection.model?.id
                      ? "text-foreground/90"
                      : "text-muted-foreground/70",
                  )}
                />
              </span>
              <IconChevronRight
                className="size-3 shrink-0 rotate-90 text-muted-foreground/50"
                aria-hidden
              />
            </div>
            {settings && (props.onThinkingLevel || showFast) ? (
              <span className="w-full truncate text-left text-caption text-muted-foreground/80">
                {props.onThinkingLevel ? `Thinking: ${thinkingDetailLabel(thinkingValue)}` : null}
                {props.onThinkingLevel && showFast ? " • " : null}
                {showFast ? `Fast: ${fastValue === "on" ? "On" : "Off"}` : null}
              </span>
            ) : null}
          </>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="z-50 outline-none ring-0"
          side={side}
          align={align}
          sideOffset={2}
        >
          <Menu.Popup
            className={cn(
              "flex max-h-[min(var(--available-height),20rem)] w-[min(16rem,var(--available-width))] min-w-[12rem] max-w-[16rem] flex-col overflow-hidden rounded-multi-card border border-multi-stroke bg-multi-bubble text-foreground shadow-multi-popup outline-none ring-0 backdrop-blur-xl focus:outline-none focus-visible:outline-none",
            )}
          >
            <div className="shrink-0 border-b border-multi-stroke/50 px-2 py-1.5">
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={stopMenuSearchBubbling}
                placeholder="Search models"
                className="flex h-7 w-full rounded-multi-control border-0 bg-multi-hover/50 px-2 text-body text-foreground outline-none ring-0 placeholder:text-muted-foreground/50 focus:outline-none focus-visible:outline-none focus-visible:ring-0"
              />
            </div>
            {list.length === 0 ? (
              <div className="shrink-0 px-4 py-3 text-center text-body text-muted-foreground/70">
                {failed
                  ? "Unable to load models."
                  : props.items.length === 0
                    ? "No models available yet."
                    : "No matching models."}
              </div>
            ) : null}
            {list.length > 0 ? (
              <div className="max-h-[min(17rem,calc(min(var(--available-height,100dvh),20rem)-5.25rem))] min-h-0 overflow-y-auto overscroll-contain pb-1 pt-0">
                {list.map((item) => {
                  const selected =
                    item.provider === props.selection.model?.provider &&
                    item.id === props.selection.model?.id;
                  const modeLabel = item.reasoning
                    ? selected
                      ? thinkingDetailLabel(thinkingValue)
                      : "Reasoning"
                    : undefined;
                  return (
                    <Menu.Item
                      key={item.key}
                      label={`${displayModelName(item.name || item.id)} ${displayProviderName(item.provider)}`}
                      closeOnClick={false}
                      onClick={() => {
                        props.onSelect(item);
                        setOpen(false);
                        setQuery("");
                      }}
                      className={cn(
                        "group flex min-h-7 cursor-pointer items-center gap-2 rounded px-4 py-1 text-body outline-none ring-0 transition-colors hover:bg-multi-hover data-highlighted:bg-multi-hover focus-visible:outline-none focus-visible:ring-0",
                        selected && "bg-multi-active",
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="min-w-0 flex-1 overflow-hidden">
                          <PretextOneLine
                            text={displayModelName(item.name || item.id)}
                            className="block w-full min-w-0 text-left text-body text-foreground"
                          />
                        </span>
                        <span className="max-w-[5rem] shrink-0 truncate text-detail text-muted-foreground/70">
                          {displayProviderName(item.provider)}
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          {item.reasoning ? (
                            <span className="inline-flex shrink-0" title={modeLabel}>
                              <IconBrain
                                className="size-3 shrink-0 text-muted-foreground/75"
                                aria-hidden
                              />
                            </span>
                          ) : null}
                          {selected ? (
                            <IconCheckmark1Small className="size-3.5 shrink-0 text-muted-foreground/70" />
                          ) : null}
                        </div>
                      </div>
                    </Menu.Item>
                  );
                })}
              </div>
            ) : null}
            {showThinking || showFast ? (
              <>
                <Menu.Separator className="mx-0 my-0 h-px shrink-0 bg-multi-stroke/50" />
                {showThinking ? (
                  <Menu.SubmenuRoot>
                    <Menu.SubmenuTrigger
                      disabled={locked}
                      className="flex min-h-7 cursor-pointer items-center gap-2 rounded px-4 py-1 text-body outline-none ring-0 hover:bg-multi-hover data-[highlighted]:bg-multi-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-40 focus-visible:outline-none focus-visible:ring-0"
                      label="Thinking"
                    >
                      <span className="min-w-0 flex-1 text-left">Thinking</span>
                      <span className="shrink-0 text-muted-foreground/70">
                        {thinkingDetailLabel(thinkingValue)}
                      </span>
                      <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                    </Menu.SubmenuTrigger>
                    <Menu.Portal>
                      <Menu.Positioner
                        className="z-50 outline-none ring-0"
                        side="right"
                        align="end"
                        sideOffset={2}
                      >
                        <Menu.Popup
                          className={cn(
                            "w-[min(14rem,var(--available-width))] min-w-[10rem] max-w-[14rem] overflow-hidden rounded-multi-card border border-multi-stroke bg-multi-bubble py-1 text-foreground shadow-multi-popup outline-none ring-0 backdrop-blur-md focus:outline-none focus-visible:outline-none",
                          )}
                        >
                          <Menu.Group>
                            <Menu.GroupLabel className="px-4 pb-1 pt-2 text-detail text-muted-foreground/70">
                              Reasoning
                            </Menu.GroupLabel>
                            <Menu.RadioGroup
                              value={thinkingValue}
                              onValueChange={(v) => {
                                props.onThinkingLevel?.(v as ThinkingLevel);
                              }}
                            >
                              {thinkingItems.map((opt) => (
                                <Menu.RadioItem
                                  key={opt.value}
                                  value={opt.value}
                                  closeOnClick={false}
                                  className="flex min-h-7 cursor-pointer items-center gap-2 rounded px-4 py-1 text-body outline-none ring-0 hover:bg-multi-hover data-[highlighted]:bg-multi-hover focus-visible:outline-none focus-visible:ring-0"
                                >
                                  <span className="min-w-0 flex-1">{opt.label}</span>
                                  <Menu.RadioItemIndicator className="flex size-4 shrink-0 items-center justify-center">
                                    <IconCheckmark1Small className="size-3.5 text-muted-foreground/80" />
                                  </Menu.RadioItemIndicator>
                                </Menu.RadioItem>
                              ))}
                            </Menu.RadioGroup>
                          </Menu.Group>
                        </Menu.Popup>
                      </Menu.Positioner>
                    </Menu.Portal>
                  </Menu.SubmenuRoot>
                ) : null}
                {showFast ? (
                  <>
                    {showThinking ? (
                      <Menu.Separator className="mx-0 my-0 h-px shrink-0 bg-multi-stroke/50" />
                    ) : null}
                    <Menu.SubmenuRoot>
                      <Menu.SubmenuTrigger
                        disabled={locked}
                        className="flex min-h-7 cursor-pointer items-center gap-2 rounded px-4 py-1 text-body outline-none ring-0 hover:bg-multi-hover data-[highlighted]:bg-multi-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-40 focus-visible:outline-none focus-visible:ring-0"
                        label="Fast Mode"
                      >
                        <span className="min-w-0 flex-1 text-left">Fast Mode</span>
                        <span className="shrink-0 text-muted-foreground/70">
                          {fastValue === "on" ? "On" : "Off"}
                        </span>
                        <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                      </Menu.SubmenuTrigger>
                      <Menu.Portal>
                        <Menu.Positioner
                          className="z-50 outline-none ring-0"
                          side="right"
                          align="end"
                          sideOffset={2}
                        >
                          <Menu.Popup
                            className={cn(
                              "w-[min(14rem,var(--available-width))] min-w-[10rem] max-w-[14rem] overflow-hidden rounded-multi-card border border-multi-stroke bg-multi-bubble py-1 text-foreground shadow-multi-popup outline-none ring-0 backdrop-blur-md focus:outline-none focus-visible:outline-none",
                            )}
                          >
                            <Menu.Group>
                              <Menu.GroupLabel className="px-4 pb-1 pt-2 text-detail text-muted-foreground/70">
                                Service Tier
                              </Menu.GroupLabel>
                              <Menu.RadioGroup
                                value={fastValue}
                                onValueChange={(v) => {
                                  props.onFastMode?.(v === "on");
                                }}
                              >
                                <Menu.RadioItem
                                  value="off"
                                  closeOnClick={false}
                                  className="flex min-h-7 cursor-pointer items-center gap-2 rounded px-4 py-1 text-body outline-none ring-0 hover:bg-multi-hover data-[highlighted]:bg-multi-hover focus-visible:outline-none focus-visible:ring-0"
                                >
                                  <span className="min-w-0 flex-1">Off</span>
                                  <Menu.RadioItemIndicator className="flex size-4 shrink-0 items-center justify-center">
                                    <IconCheckmark1Small className="size-3.5 text-muted-foreground/80" />
                                  </Menu.RadioItemIndicator>
                                </Menu.RadioItem>
                                <Menu.RadioItem
                                  value="on"
                                  closeOnClick={false}
                                  className="flex min-h-7 cursor-pointer items-center gap-2 rounded px-4 py-1 text-body outline-none ring-0 hover:bg-multi-hover data-[highlighted]:bg-multi-hover focus-visible:outline-none focus-visible:ring-0"
                                >
                                  <span className="min-w-0 flex-1">On</span>
                                  <Menu.RadioItemIndicator className="flex size-4 shrink-0 items-center justify-center">
                                    <IconCheckmark1Small className="size-3.5 text-muted-foreground/80" />
                                  </Menu.RadioItemIndicator>
                                </Menu.RadioItem>
                              </Menu.RadioGroup>
                            </Menu.Group>
                          </Menu.Popup>
                        </Menu.Positioner>
                      </Menu.Portal>
                    </Menu.SubmenuRoot>
                  </>
                ) : null}
              </>
            ) : null}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
});
ModelPicker.displayName = "ModelPicker";
