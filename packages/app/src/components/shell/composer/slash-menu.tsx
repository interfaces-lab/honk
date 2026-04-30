/**
 * Shared slash and @mention launcher.
 * Uses Base UI Popover because the textarea stays the real input owner.
 *
 * Pixel targets aligned with `ui-menu` / `ui-slash-menu` reference layout:
 *   root        font-size:12px  line-height:16px
 *   content     padding:4px
 *   list        gap:1px
 *   row         padding:3px 4px  gap:6px  border-radius:4px
 *   row:focus   bg:quaternary
 *   icon        12×16
 *   description 11px/14px  tertiary
 *   section     11px/14px  tertiary  padding:4px
 *   highlight   font-weight:600
 */
import type { ShellFileHit, ShellFilePreview } from "~/lib/ui-session-types";
import { Popover } from "@base-ui/react/popover";
import {
  IconBuildingBlocks,
  IconChevronRight,
  IconFileBend,
  IconFolder1,
  IconImages1,
  IconLightning,
} from "central-icons";
import type { ReactNode, RefObject } from "react";
import { cn } from "~/lib/utils";
import { ScrollArea } from "@multi/ui/scroll-area";
import { ComposerFilePreview } from "./file-preview";
import type { SlashItem, SlashMenuRow } from "./slash-registry";

function kindGlyph(kind: SlashItem["kind"]) {
  if (kind === "skill") return IconBuildingBlocks;
  return IconLightning;
}

/** Slash menu query highlight — semibold matched segment (`ui-slash-menu__highlight`). */
function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-semibold text-primary">{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  );
}

function highlightPath(path: string, query: string): ReactNode {
  if (!query) return path;
  const lower = path.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return path;
  return (
    <>
      {path.slice(0, idx)}
      <span className="font-semibold text-foreground/80">{path.slice(idx, idx + q.length)}</span>
      {path.slice(idx + q.length)}
    </>
  );
}

function dirOf(path: string): string | null {
  const cut = path.lastIndexOf("/");
  return cut > 0 ? path.slice(0, cut) : null;
}

export function ComposerTokenMenu(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: RefObject<Element | null> | null;
  variant: "hero" | "dock";
  mode: "slash" | "file";
  query: string;
  slashRows: SlashMenuRow[];
  slashActive: number;
  onSlashHover: (optionIndex: number) => void;
  onSlashPick: (item: SlashItem) => void;
  hits: ShellFileHit[];
  fileActive: number;
  onFileHover: (i: number) => void;
  onFilePick: (hit: ShellFileHit) => void;
  filePick: ShellFileHit | null;
  preview: ShellFilePreview | null;
  loading: boolean;
}) {
  const side = props.variant === "dock" ? "top" : "bottom";
  const anchor = props.anchor ?? undefined;

  return (
    <Popover.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          side={side}
          align="start"
          sideOffset={8}
          className="z-50 outline-none"
        >
          {/* Root menu shell: 12px/16px, elevated surface, soft shadow */}
          <Popover.Popup
            data-slot="popover-token-menu"
            initialFocus={false}
            finalFocus={false}
            className={cn(
              "multi-slash-menu-popup multi-composer-token-menu",
              "origin-[var(--transform-origin)]",
              "overflow-hidden rounded-multi-card border border-multi-stroke bg-multi-bubble shadow-multi-popup backdrop-blur-xl",
              "w-[min(320px,calc(100vw-2rem))] text-[12px] leading-[16px] select-none",
            )}
          >
            {props.mode === "file" ? <FilePane {...props} /> : <SlashPane {...props} />}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ── Slash mode ───────────────────────────────────────────── */

function SlashPane(props: {
  query: string;
  slashRows: SlashMenuRow[];
  slashActive: number;
  onSlashHover: (optionIndex: number) => void;
  onSlashPick: (item: SlashItem) => void;
}) {
  return (
    <div className="max-h-72 min-h-0 overflow-y-auto overscroll-contain">
      {/* Menu content: 4px padding */}
      <div className="flex flex-col gap-px p-1" role="listbox" aria-label="Slash commands">
        {props.slashRows.map((row) => {
          if (row.kind === "header") {
            return (
              <div
                key={row.key}
                /* Section title: 11px/14px tertiary */
                className="px-1 pt-1.5 pb-0.5 text-[11px] leading-[14px] text-muted-foreground/55 first:pt-0.5"
                role="presentation"
              >
                {row.label}
              </div>
            );
          }
          const active = row.optionIndex === props.slashActive;
          const Glyph = kindGlyph(row.item.kind);
          return (
            <button
              key={`${row.item.id}:${row.optionIndex}`}
              type="button"
              role="option"
              aria-selected={active}
              data-highlighted={active ? "" : undefined}
              /* Menu row: 3px×4px padding, 6px gap, 4px radius */
              className={cn(
                "flex w-full items-center gap-[6px] rounded-sm px-1 py-[3px] text-left transition-colors motion-reduce:transition-none",
                active
                  ? "bg-multi-active text-foreground"
                  : "text-foreground/82 hover:bg-multi-hover/40",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                props.onSlashHover(row.optionIndex);
                props.onSlashPick(row.item);
              }}
              onMouseEnter={() => props.onSlashHover(row.optionIndex)}
            >
              {/* Leading icon slot: 12×16 secondary */}
              <span className="inline-flex h-4 w-3 shrink-0 items-center justify-center text-muted-foreground/60">
                <Glyph className="size-3" />
              </span>
              {/* Title row: 8px gap, flex-1 */}
              <span className="flex min-w-0 flex-1 items-center gap-2">
                {/* Primary title, truncate */}
                <span className="truncate text-foreground">
                  /{highlightMatch(row.item.name, props.query)}
                </span>
                {/* Inline description: tertiary, truncate */}
                {row.item.description ? (
                  <span className="min-w-0 flex-1 truncate text-[11px] leading-[14px] text-muted-foreground/50">
                    {row.item.description}
                  </span>
                ) : null}
              </span>
              {/* Trailing pill: tertiary, max 180px */}
              <span className="max-w-[180px] shrink-0 truncate text-[11px] leading-[14px] text-muted-foreground/45">
                {row.item.pill}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── File / @mention mode ─────────────────────────────────── */

function FilePane(props: {
  query: string;
  hits: ShellFileHit[];
  fileActive: number;
  onFileHover: (i: number) => void;
  onFilePick: (hit: ShellFileHit) => void;
  filePick: ShellFileHit | null;
  preview: ShellFilePreview | null;
  loading: boolean;
}) {
  return (
    <div className="grid bg-multi-border/20 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
      <div className="min-w-0 border-b border-multi-border/20 md:border-r md:border-b-0">
        <ScrollArea className="max-h-74">
          {/* Menu content: 4px padding */}
          <div
            className="flex flex-col gap-px p-1"
            role="listbox"
            aria-label="File mentions"
            aria-busy={props.loading}
          >
            {props.loading ? (
              <div className="px-1 py-2 text-[11px] leading-[14px] text-muted-foreground/55">
                Loading…
              </div>
            ) : (
              props.hits.map((item, i) => {
                const active = i === props.fileActive;
                const dir = dirOf(item.path);
                return (
                  <button
                    key={item.path}
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-highlighted={active ? "" : undefined}
                    /* Menu row: 3px×4px padding, 6px gap, 4px radius */
                    className={cn(
                      "flex w-full items-center gap-[6px] rounded-sm px-1 py-[3px] text-left transition-colors motion-reduce:transition-none",
                      active
                        ? "multi-composer-object-row--active"
                        : "text-foreground/82 hover:bg-multi-hover/40",
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      props.onFileHover(i);
                      props.onFilePick(item);
                    }}
                    onMouseEnter={() => props.onFileHover(i)}
                  >
                    {/* Leading icon slot: 12×16 */}
                    <span
                      className={cn(
                        "inline-flex h-4 w-3 shrink-0 items-center justify-center",
                        active
                          ? "text-[color:var(--multi-composer-object-fg-muted)]"
                          : "text-muted-foreground/60",
                      )}
                    >
                      {item.kind === "dir" ? (
                        <IconFolder1 className="size-3" />
                      ) : item.kind === "image" ? (
                        <IconImages1 className="size-3" />
                      ) : (
                        <IconFileBend className="size-3" />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 items-baseline gap-1">
                      <span
                        className={cn(
                          "shrink-0 truncate",
                          active ? "text-current" : "text-foreground",
                        )}
                      >
                        {highlightMatch(item.name, props.query)}
                      </span>
                      {dir ? (
                        <span
                          className={cn(
                            "min-w-0 truncate text-[11px] leading-[14px]",
                            active
                              ? "text-[color:var(--multi-composer-object-fg-muted)]"
                              : "text-muted-foreground/40",
                          )}
                          style={{ direction: "rtl", textAlign: "left" }}
                        >
                          {highlightPath(dir, props.query)}
                        </span>
                      ) : null}
                    </span>
                    {item.kind === "dir" ? (
                      <IconChevronRight
                        className={cn(
                          "size-2.5 shrink-0",
                          active
                            ? "text-[color:var(--multi-composer-object-fg-muted)]"
                            : "text-muted-foreground/45",
                        )}
                      />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>
      <ComposerFilePreview item={props.filePick} preview={props.preview} />
    </div>
  );
}
