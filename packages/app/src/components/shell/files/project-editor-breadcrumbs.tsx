import { cn } from "~/lib/utils";

export type ProjectEditorBreadcrumbTarget = {
  readonly kind: "directory" | "file";
  readonly path: string;
};

type ProjectEditorBreadcrumbSegment =
  | {
      readonly collapsed: false;
      readonly kind: "directory" | "file";
      readonly key: string;
      readonly label: string;
      readonly path: string;
    }
  | {
      readonly collapsed: true;
      readonly key: string;
      readonly label: string;
    };

function pathForSegment(segments: readonly string[], index: number): string {
  return segments.slice(0, index + 1).join("/");
}

function breadcrumbSegment(
  segments: readonly string[],
  index: number,
): ProjectEditorBreadcrumbSegment {
  const path = pathForSegment(segments, index);
  return {
    collapsed: false,
    kind: index === segments.length - 1 ? "file" : "directory",
    key: path,
    label: segments[index] ?? path,
    path,
  };
}

function visibleBreadcrumbSegments(
  segments: readonly string[],
): readonly ProjectEditorBreadcrumbSegment[] {
  if (segments.length <= 4) {
    return segments.map((_, index) => breadcrumbSegment(segments, index));
  }

  return [
    breadcrumbSegment(segments, 0),
    { collapsed: true, key: "collapsed", label: "..." },
    breadcrumbSegment(segments, segments.length - 2),
    breadcrumbSegment(segments, segments.length - 1),
  ];
}

export function ProjectEditorBreadcrumbs(props: {
  relativePath: string | null;
  onNavigate?: (target: ProjectEditorBreadcrumbTarget) => void;
}) {
  const segments = props.relativePath ? props.relativePath.split("/").filter(Boolean) : [];
  const visibleSegments = visibleBreadcrumbSegments(segments);

  return (
    <div className="flex min-w-0 select-none items-center gap-1 text-detail text-muted-foreground/65">
      {visibleSegments.map((segment, index) => (
        <span className="contents" key={segment.key}>
          {index > 0 ? <span className="shrink-0 text-muted-foreground/35">/</span> : null}
          {segment.collapsed ? (
            <span className="min-w-0 truncate px-1 text-muted-foreground/45">{segment.label}</span>
          ) : (
            <button
              type="button"
              className={cn(
                "min-w-0 truncate rounded-xs px-1 text-left outline-hidden hover:bg-honk-hover hover:text-honk-fg-primary focus-visible:bg-honk-hover focus-visible:text-honk-fg-primary",
                segment.kind === "file" && "text-honk-fg-secondary",
              )}
              title={segment.path}
              onClick={() => props.onNavigate?.({ kind: segment.kind, path: segment.path })}
            >
              {segment.label}
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
