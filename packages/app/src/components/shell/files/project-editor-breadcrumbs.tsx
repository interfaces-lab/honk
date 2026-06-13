export function ProjectEditorBreadcrumbs(props: { relativePath: string | null }) {
  const segments = props.relativePath ? props.relativePath.split("/").filter(Boolean) : [];
  const visibleSegments =
    segments.length > 4 ? [segments[0] ?? "", "...", ...segments.slice(-2)] : segments;

  // Presentational only — the path is a label, not a navigation control, so it
  // must not show an interactive (pointer) cursor on hover.
  return (
    <div className="flex min-w-0 cursor-default select-none items-center gap-1 text-detail text-muted-foreground/65">
      {visibleSegments.map((segment, index) => (
        <span className="contents" key={`${segment}:${index}`}>
          {index > 0 ? <span className="shrink-0 text-muted-foreground/35">/</span> : null}
          <span className="min-w-0 truncate last:text-honk-fg-secondary">{segment}</span>
        </span>
      ))}
    </div>
  );
}
