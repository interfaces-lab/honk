"use client";
import { IconChevronRightMedium, IconClipboard, IconStepBack } from "central-icons";
import type { GitFilePatchResult } from "@multi/contracts";
import { type KeyboardEvent, type MouseEvent, type MutableRefObject, useRef } from "react";
import { toast } from "sonner";

import type { DiffRow } from "~/hooks/use-environment-git";
import { cn } from "~/lib/utils";
import { useMountEffect } from "~/hooks/use-mount-effect";

import { DiffViewer } from "./diff-viewer";
import { GitKindBadge } from "./git-kind-badge";
import { VsFileIcon } from "./vscode-file-icon";

function splitPath(path: string) {
  const idx = path.lastIndexOf("/");
  if (idx < 0) return { prefix: "", name: path };
  return { prefix: path.slice(0, idx + 1), name: path.slice(idx + 1) };
}

export function GitDiffCard(props: {
  file: DiffRow;
  selected: boolean;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  patch: GitFilePatchResult | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  diffStyle: "unified" | "split";
  viewed: boolean;
  onToggleViewed: () => void;
  onRevert: () => void;
  requestPrefetchForIdRef: MutableRefObject<(id: string) => void>;
  diffLayoutKey: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  const copyPath = (event: MouseEvent) => {
    event.stopPropagation();
    void navigator.clipboard.writeText(props.file.path);
    toast.success("Path copied");
  };

  const { prefix, name } = splitPath(props.file.path);
  const pathLabel = prefix ? `${name} ${prefix}` : name;
  const showLoading = props.loading || (!props.loaded && !props.error);
  const toggleExpanded = () => props.onExpandedChange(!props.expanded);
  const toggleExpandedFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleExpanded();
  };

  return (
    <div
      ref={rootRef}
      data-diff-card-id={props.file.id}
      className={cn(
        "@container flex min-h-0 min-w-0 select-none flex-col overflow-hidden border-0 border-b border-multi-workbench-panel-border-muted bg-(--multi-git-diff-editor-background) transition-colors last:border-b-transparent",
        props.selected && "bg-(--multi-git-diff-editor-background)",
      )}
    >
      {props.expanded ? (
        <ExpandedGitDiffCardPrefetchObserver
          key={props.file.id}
          fileId={props.file.id}
          rootRef={rootRef}
          requestPrefetchForIdRef={props.requestPrefetchForIdRef}
        />
      ) : null}
      <div
        className={cn(
          "group/git-diff-header flex min-h-[30px] shrink-0 cursor-pointer flex-nowrap items-center gap-1.5 overflow-hidden border-b px-1.5 py-1 hover:bg-multi-workbench-toolbar-hover-wash",
          props.expanded ? "border-multi-git-diff-header-border" : "border-b-transparent",
        )}
        role="button"
        tabIndex={0}
        aria-expanded={props.expanded}
        onClick={toggleExpanded}
        onKeyDown={toggleExpandedFromKeyboard}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            toggleExpanded();
          }}
          className="group/git-diff-toggle inline-flex size-[14px] shrink-0 items-center justify-center text-multi-icon-tertiary focus-visible:rounded-[2px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-multi-stroke-focused"
          aria-label={props.expanded ? "Collapse diff" : "Expand diff"}
          aria-expanded={props.expanded}
          title={props.expanded ? "Collapse diff" : "Expand diff"}
        >
          <span className="relative inline-flex size-4 items-center justify-center" aria-hidden>
            <span className="absolute inset-0 inline-flex items-center justify-center text-multi-icon-tertiary opacity-100 transition-opacity duration-100 ease-out group-hover/git-diff-header:opacity-0 group-hover/git-diff-toggle:opacity-0">
              <VsFileIcon path={props.file.path} className="size-3.5" />
            </span>
            <span className="absolute inset-0 inline-flex items-center justify-center text-multi-icon-tertiary opacity-0 transition-opacity duration-100 ease-out group-hover/git-diff-header:opacity-100 group-hover/git-diff-toggle:opacity-100">
              {props.expanded ? (
                <IconChevronRightMedium className="size-3.5 shrink-0 rotate-90" />
              ) : (
                <IconChevronRightMedium className="size-3.5 shrink-0" />
              )}
            </span>
          </span>
        </button>
        <span
          className="flex min-w-0 flex-1 flex-nowrap items-center overflow-hidden text-[12px]/4"
          title={props.file.path}
        >
          <span className="block w-full max-w-full min-w-0 flex-1 overflow-hidden text-ellipsis text-[12px]/4 font-medium whitespace-nowrap text-[color-mix(in_srgb,var(--foreground)_92%,transparent)]">
            {pathLabel}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px]/4 tabular-nums @max-[360px]:gap-1">
          {props.file.add > 0 ? (
            <span className="text-(--multi-diff-addition)">+{props.file.add}</span>
          ) : null}
          {props.file.del > 0 ? (
            <span className="text-(--multi-diff-deletion)">-{props.file.del}</span>
          ) : null}
        </span>
        <span className="inline-flex min-w-0 shrink-0 items-center gap-(--multi-workbench-sub-chrome-action-gap)">
          <button
            type="button"
            onClick={copyPath}
            className="inline-flex size-(--multi-workbench-action-size) shrink-0 items-center justify-center rounded-[5px] text-[color-mix(in_srgb,var(--foreground)_52%,transparent)] transition-[background-color,color] duration-100 ease-out hover:bg-(--multi-workbench-toolbar-hover-background) hover:text-foreground"
            aria-label="Copy path"
            title="Copy path"
          >
            <IconClipboard className="size-3.5 shrink-0" />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              props.onRevert();
            }}
            className="inline-flex size-(--multi-workbench-action-size) shrink-0 items-center justify-center rounded-[5px] text-[color-mix(in_srgb,var(--foreground)_52%,transparent)] transition-[background-color,color] duration-100 ease-out hover:bg-(--multi-workbench-toolbar-hover-background) hover:text-foreground"
            aria-label="Discard changes"
            title="Discard changes"
          >
            <IconStepBack className="size-3.5 shrink-0" />
          </button>
          <label
            className="inline-flex min-h-(--multi-workbench-action-size) shrink-0 cursor-(--multi-button-cursor) items-center gap-1 rounded-[5px] px-[3px] pr-1 text-[11px]/4 text-[color-mix(in_srgb,var(--foreground)_58%,transparent)] hover:bg-(--multi-workbench-toolbar-hover-background) hover:text-foreground @max-[360px]:w-(--multi-workbench-action-size) @max-[360px]:justify-center @max-[360px]:px-[3px]"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <input
              type="checkbox"
              aria-label="Viewed"
              checked={props.viewed}
              onChange={() => {
                props.onToggleViewed();
                props.onExpandedChange(false);
              }}
              className="size-3.5 rounded border-multi-border/60 accent-primary"
            />
            <span className="@max-[360px]:absolute @max-[360px]:size-px @max-[360px]:overflow-hidden @max-[360px]:whitespace-nowrap @max-[360px]:[clip-path:inset(50%)]">
              Viewed
            </span>
          </label>
          <GitKindBadge state={props.file.state} />
        </span>
      </div>
      {props.expanded ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-(--multi-git-diff-editor-background) select-text">
          {showLoading ? (
            <div className="flex flex-col gap-2 p-3">
              <div className="h-3 w-full max-w-56 animate-pulse rounded bg-muted/35" />
              <div className="h-3 w-full animate-pulse rounded bg-muted/28" />
            </div>
          ) : props.error ? (
            <div className="p-3 text-detail text-destructive/90">{props.error}</div>
          ) : (
            <DiffViewer
              filePatch={props.patch}
              path={props.file.path}
              state={props.file.state}
              prevPath={props.file.prevPath}
              diffStyle={props.diffStyle}
              className="h-full min-h-[12rem]"
              layoutKey={props.diffLayoutKey}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function ExpandedGitDiffCardPrefetchObserver(props: {
  readonly fileId: string;
  readonly rootRef: MutableRefObject<HTMLDivElement | null>;
  readonly requestPrefetchForIdRef: MutableRefObject<(id: string) => void>;
}) {
  useMountEffect(() => {
    const el = props.rootRef.current;
    if (!el) return;

    let prefetched = false;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || prefetched) continue;
          prefetched = true;
          props.requestPrefetchForIdRef.current(props.fileId);
          obs.disconnect();
          return;
        }
      },
      { root: null, rootMargin: "600px 0px 480px 0px", threshold: 0 },
    );

    obs.observe(el);
    return () => obs.disconnect();
  });

  return null;
}
