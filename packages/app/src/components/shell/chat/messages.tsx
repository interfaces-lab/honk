import type { UiSessionItem, UiWorkingState } from "~/lib/ui-session-types";
import type { WorkLogEntry } from "~/lib/work-log";
import type { ProposedPlan } from "~/types";
import { createContext, memo, useCallback, useEffect, useMemo, useRef } from "react";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import {
  deriveTimelineEntries,
  deriveMessagesTimelineRows,
  computeStableTimelineRows,
  type TimelineRow,
  type StableTimelineRowsState,
} from "~/lib/chat-timeline";
import { TimelineRowContent, ChatWorkingRow } from "./rows";

interface TimelineCtxState {
  expanded: boolean;
}

export const TimelineRowCtx = createContext<TimelineCtxState>({ expanded: false });

export const ChatMessages = memo(function ChatMessages(props: {
  items: UiSessionItem[];
  work: UiWorkingState | null;
  workLog: WorkLogEntry[];
  plans: ProposedPlan[];
  busy: boolean;
  thinking: boolean;
  since: string | null;
  expanded: boolean;
}) {
  const ref = useRef<LegendListRef>(null);

  const entries = useMemo(
    () => deriveTimelineEntries(props.items, props.plans, props.workLog),
    [props.items, props.plans, props.workLog],
  );

  const raw = useMemo(
    () =>
      deriveMessagesTimelineRows({
        entries,
        isWorking: props.busy,
        since: props.since,
      }),
    [entries, props.busy, props.since],
  );

  const rows = useStableRows(raw);

  const ctx = useMemo<TimelineCtxState>(() => ({ expanded: props.expanded }), [props.expanded]);

  const render = useCallback(
    ({ item }: { item: TimelineRow }) => {
      if (item.kind === "working") {
        return (
          <div className="mx-auto max-w-[43.875rem] px-4 md:px-8">
            <ChatWorkingRow
              work={props.work}
              busy={props.busy}
              thinking={props.thinking}
              since={props.since}
            />
          </div>
        );
      }
      return (
        <div className="mx-auto max-w-[43.875rem] px-4 md:px-8">
          <TimelineRowContent row={item} expanded={ctx.expanded} />
        </div>
      );
    },
    [ctx.expanded, props.work, props.busy, props.thinking, props.since],
  );

  const prev = useRef(rows.length);
  useEffect(() => {
    const was = prev.current;
    prev.current = rows.length;
    if (was > 0 || rows.length === 0) return;
    const id = window.requestAnimationFrame(() => {
      void ref.current?.scrollToEnd?.({ animated: false });
    });
    return () => {
      window.cancelAnimationFrame(id);
    };
  }, [rows.length]);

  return (
    <TimelineRowCtx.Provider value={ctx}>
      <LegendList<TimelineRow>
        ref={ref}
        data={rows}
        keyExtractor={key}
        renderItem={render}
        estimatedItemSize={90}
        initialScrollAtEnd
        maintainScrollAtEnd
        maintainScrollAtEndThreshold={0.1}
        maintainVisibleContentPosition
        className="min-h-0 flex-1 overflow-x-hidden overscroll-y-contain"
        ListHeaderComponent={<div className="h-4" />}
        ListFooterComponent={<div className="h-4" />}
      />
    </TimelineRowCtx.Provider>
  );
});

function key(item: TimelineRow) {
  return item.id;
}

function useStableRows(rows: TimelineRow[]): TimelineRow[] {
  const prev = useRef<StableTimelineRowsState>({
    byId: new Map<string, TimelineRow>(),
    result: [],
  });
  return useMemo(() => {
    const next = computeStableTimelineRows(rows, prev.current);
    prev.current = next;
    return next.result;
  }, [rows]);
}
