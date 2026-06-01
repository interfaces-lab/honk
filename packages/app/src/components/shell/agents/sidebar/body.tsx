import type { ScopedThreadRef } from "@multi/contracts";
import { type DragEvent, useCallback, useMemo, useState } from "react";

import { useUiStateStore } from "~/stores/ui-state-store";
import { EMPTY_VISIBLE_THREAD_REFS, sidebarThreadPrewarmLimit } from "./constants";
import type { SidebarDragPayload, SidebarDropTarget } from "./drag-and-drop";
import { areSameThreadRefs, createThreadRefsKey } from "./keys";
import { AgentSidebarSection } from "./section";
import { RetainedThreadDetailSubscriptions } from "./section-sync";
import type { AgentSidebarProps } from "./types";

export function AgentSidebarBody(props: AgentSidebarProps) {
  const reorderProjects = useUiStateStore((store) => store.reorderProjects);
  const [dragPayload, setDragPayload] = useState<SidebarDragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<SidebarDropTarget | null>(null);
  const [visibleThreadRefsBySectionId, setVisibleThreadRefsBySectionId] = useState<
    Record<string, readonly ScopedThreadRef[]>
  >({});
  const onSidebarDragStart = useCallback(
    (event: DragEvent<HTMLElement>, payload: SidebarDragPayload) => {
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", payload.sectionId);
      setDragPayload(payload);
      setDropTarget(null);
    },
    [],
  );
  const onSidebarDragEnd = useCallback(() => {
    setDragPayload(null);
    setDropTarget(null);
  }, []);
  const onSidebarDragOver = useCallback(
    (event: DragEvent<HTMLElement>, target: SidebarDragPayload) => {
      if (
        !dragPayload ||
        dragPayload.sectionId === target.sectionId ||
        target.projectOrderKeys.length === 0
      ) {
        setDropTarget(null);
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";

      const previousPosition =
        dropTarget?.sectionId === target.sectionId ? dropTarget.position : null;

      const rect = event.currentTarget.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const position =
        y < rect.height * 0.4
          ? "before"
          : y > rect.height * 0.6
            ? "after"
            : (previousPosition ?? (y < rect.height / 2 ? "before" : "after"));

      setDropTarget((current) => {
        if (current?.sectionId === target.sectionId && current.position === position) {
          return current;
        }
        return { ...target, position };
      });
    },
    [dragPayload, dropTarget],
  );
  const onSidebarDrop = useCallback(
    (event: DragEvent<HTMLElement>, target: SidebarDragPayload) => {
      if (
        !dragPayload ||
        dragPayload.sectionId === target.sectionId ||
        target.projectOrderKeys.length === 0
      ) {
        setDropTarget(null);
        return;
      }

      let position = dropTarget?.sectionId === target.sectionId ? dropTarget.position : null;
      if (!position) {
        const rect = event.currentTarget.getBoundingClientRect();
        position = event.clientY - rect.top > rect.height / 2 ? "after" : "before";
      }

      event.preventDefault();
      event.stopPropagation();
      reorderProjects(dragPayload.projectOrderKeys, target.projectOrderKeys, position === "after");

      setDragPayload(null);
      setDropTarget(null);
    },
    [dragPayload, dropTarget, reorderProjects],
  );
  const onVisibleThreadRefsChange = useCallback(
    (sectionId: string, threadRefs: readonly ScopedThreadRef[]) => {
      setVisibleThreadRefsBySectionId((current) => {
        const previousThreadRefs = current[sectionId] ?? EMPTY_VISIBLE_THREAD_REFS;
        if (areSameThreadRefs(previousThreadRefs, threadRefs)) {
          return current;
        }
        if (threadRefs.length === 0) {
          if (!(sectionId in current)) {
            return current;
          }
          const next = { ...current };
          delete next[sectionId];
          return next;
        }
        return {
          ...current,
          [sectionId]: threadRefs,
        };
      });
    },
    [],
  );
  const visibleThreadRefs = useMemo(
    () =>
      props.sections.flatMap(
        (section) => visibleThreadRefsBySectionId[section.id] ?? EMPTY_VISIBLE_THREAD_REFS,
      ),
    [props.sections, visibleThreadRefsBySectionId],
  );
  const prewarmedSidebarThreadRefs = useMemo(
    () => visibleThreadRefs.slice(0, sidebarThreadPrewarmLimit),
    [visibleThreadRefs],
  );
  const prewarmedSidebarThreadRefsKey = useMemo(
    () => createThreadRefsKey(prewarmedSidebarThreadRefs),
    [prewarmedSidebarThreadRefs],
  );

  return (
    <div className="sidebar-body flex min-h-0 flex-1 flex-col gap-px overflow-y-auto pt-0 pb-4">
      <RetainedThreadDetailSubscriptions
        key={prewarmedSidebarThreadRefsKey}
        threadRefs={prewarmedSidebarThreadRefs}
      />
      {props.sections.map((section) => (
        <AgentSidebarSection
          key={section.id}
          section={section}
          selectedId={props.selectedId}
          dragPayload={dragPayload}
          dropTarget={dropTarget}
          onSidebarDragEnd={onSidebarDragEnd}
          onSidebarDragOver={onSidebarDragOver}
          onSidebarDragStart={onSidebarDragStart}
          onSidebarDrop={onSidebarDrop}
          onSelectAgent={props.onSelectAgent}
          onVisibleThreadRefsChange={onVisibleThreadRefsChange}
          {...(props.onNewAgent ? { onNewAgent: props.onNewAgent } : {})}
          {...(props.onPrefetchAgent ? { onPrefetchAgent: props.onPrefetchAgent } : {})}
        />
      ))}
    </div>
  );
}

