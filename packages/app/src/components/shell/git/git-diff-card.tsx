"use client";
import {
  IconArrowRotateCounterClockwise,
  IconChevronDownSmall,
  IconChevronRightSmall,
  IconClipboard,
} from "central-icons";
import {
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
  useEffect,
  useRef,
} from "react";
import { toast } from "sonner";

import { PretextOneLine } from "~/components/pretext-one-line";
import type { DiffRow } from "~/hooks/use-environment-git";
import type { GitPatchData } from "~/lib/native-git-react-query";
import { VsFileIcon } from "~/lib/vscode-file-icon";
import { cn } from "~/lib/utils";

import { DiffViewer } from "./diff-viewer";
import { GitKindBadge } from "./git-kind-badge";

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
  patch: GitPatchData | null;
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
  const prefetchedRef = useRef(false);

  useEffect(() => {
    prefetchedRef.current = false;
    if (!props.expanded) return;

    const el = rootRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || prefetchedRef.current) continue;
          prefetchedRef.current = true;
          props.requestPrefetchForIdRef.current(props.file.id);
          obs.disconnect();
          return;
        }
      },
      { root: null, rootMargin: "600px 0px 480px 0px", threshold: 0 },
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [props.expanded, props.file.id, props.requestPrefetchForIdRef]);

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
      className={cn("git-diff-card select-none", props.selected && "git-diff-card--selected")}
    >
      <div
        className={cn(
          "group/git-diff-header flex min-h-[30px] shrink-0 cursor-pointer flex-nowrap items-center gap-[6px] overflow-hidden border-b px-[6px] py-1 hover:bg-multi-workbench-toolbar-hover-wash",
          props.expanded
            ? "border-multi-git-diff-header-border"
            : "border-b-transparent",
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
                <IconChevronDownSmall className="size-3.5 shrink-0" />
              ) : (
                <IconChevronRightSmall className="size-3.5 shrink-0" />
              )}
            </span>
          </span>
        </button>
        <span className="git-diff-card__title" title={props.file.path}>
          <PretextOneLine
            text={pathLabel}
            title={props.file.path}
            truncate="middle"
            className="git-diff-card__basename"
          />
        </span>
        <span className="git-diff-card__stats">
          {props.file.add > 0 ? (
            <span className="git-diff-card__stat-plus">+{props.file.add}</span>
          ) : null}
          {props.file.del > 0 ? (
            <span className="git-diff-card__stat-minus">-{props.file.del}</span>
          ) : null}
        </span>
        <span className="git-diff-card__controls">
          <button
            type="button"
            onClick={copyPath}
            className="git-diff-card__action"
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
            className="git-diff-card__action"
            aria-label="Discard changes"
            title="Discard changes"
          >
            <IconArrowRotateCounterClockwise className="size-3.5 shrink-0" />
          </button>
          <label
            className="git-diff-card__label"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <input
              type="checkbox"
              aria-label="Viewed"
              checked={props.viewed}
              onChange={() => props.onToggleViewed()}
              className="size-3.5 rounded border-multi-border/60 accent-primary"
            />
            <span className="git-diff-card__label-text">Viewed</span>
          </label>
          <GitKindBadge state={props.file.state} />
        </span>
      </div>
      {props.expanded ? (
        <div className="git-diff-card__body select-text">
          {showLoading ? (
            <div className="flex flex-col gap-2 p-3">
              <div className="h-3 w-full max-w-[14rem] animate-pulse rounded bg-muted/35" />
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
