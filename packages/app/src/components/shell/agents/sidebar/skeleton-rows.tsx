export function SkeletonRows() {
  return (
    <div className="sidebar-body flex min-h-0 flex-1 flex-col gap-sidebar-section-gap overflow-y-auto pt-0 pb-4">
      {[0, 1].map((i) => (
        <div className="flex flex-col gap-2" key={i}>
          <div
            className="h-3 w-16 animate-pulse rounded-multi-control bg-multi-bg-tertiary"
            data-skeleton={i}
          />
          <div className="flex flex-col gap-px">
            {[0, 1, 2].map((j) => (
              <div
                key={j}
                className="h-7 w-full animate-pulse rounded-multi-control bg-multi-bg-tertiary"
                data-skeleton={j}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
