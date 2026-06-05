import type {
  AgentRuntimeEvent,
  MultiRuntimeHostSnapshot,
  SessionTreeEntry,
} from "@multi/contracts";
import { Text, textVariants } from "@multi/multikit/text";
import { Liveline, type LivelinePoint } from "liveline";
import { useMemo } from "react";

import { useTheme } from "~/hooks/use-theme";
import { cn } from "~/lib/utils";
import { useAgentRuntimeStore } from "~/stores/agent-runtime-store";

import { SettingsPageContainer, SettingsSection } from "./settings-layout";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_SECONDS = 24 * 60 * 60;
const GRAPH_DAYS = 30;
const HEATMAP_DAYS = 84;
const RECENT_SESSION_LIMIT = 8;

const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

interface UsageSessionSummary {
  readonly runtimeSessionId: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly durationMs: number;
  readonly userTurns: number;
  readonly toolRuns: number;
  readonly messageCount: number;
  readonly eventCount: number;
}

interface ActivityDay {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}

interface UsageSummary {
  readonly totalSessions: number;
  readonly longestSessionMs: number;
  readonly longestStreakDays: number;
  readonly currentStreakDays: number;
  readonly heatmapDays: readonly ActivityDay[];
  readonly graphPoints: LivelinePoint[];
  readonly graphValue: number;
  readonly recentSessions: readonly UsageSessionSummary[];
  readonly maxHeatmapCount: number;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0m";
  const hours = ms / (60 * 60 * 1000);
  if (hours >= 1) {
    return `${new Intl.NumberFormat(undefined, {
      maximumFractionDigits: hours >= 10 ? 0 : 1,
    }).format(hours)}h`;
  }
  const minutes = Math.max(1, Math.round(ms / (60 * 1000)));
  return `${formatCount(minutes)}m`;
}

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function laterIso(left: string, right: string): string {
  return timestampMs(left) >= timestampMs(right) ? left : right;
}

function earlierIso(left: string, right: string): string {
  return timestampMs(left) <= timestampMs(right) ? left : right;
}

function sessionTitle(entries: readonly SessionTreeEntry[], fallback: string): string {
  const sessionInfo = entries.findLast((entry) => entry.kind === "session-info")?.text?.trim();
  if (sessionInfo) {
    return sessionInfo;
  }

  const firstUserMessage = entries.find((entry) => entry.role === "user")?.text?.trim();
  if (firstUserMessage) {
    return firstUserMessage.length > 72 ? `${firstUserMessage.slice(0, 69)}...` : firstUserMessage;
  }

  return fallback;
}

function incrementActivity(
  countsByDay: Map<string, number>,
  createdAt: string | undefined,
  amount = 1,
): void {
  if (!createdAt) return;
  const time = timestampMs(createdAt);
  if (time === 0) return;
  const key = dayKey(new Date(time));
  countsByDay.set(key, (countsByDay.get(key) ?? 0) + amount);
}

function buildDays(days: number, countsByDay: ReadonlyMap<string, number>): ActivityDay[] {
  const today = startOfLocalDay(new Date());
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today.getTime() - (days - 1 - index) * DAY_MS);
    const key = dayKey(date);
    return {
      key,
      label: DAY_LABEL_FORMATTER.format(date),
      count: countsByDay.get(key) ?? 0,
    };
  });
}

function countCurrentStreak(days: readonly ActivityDay[]): number {
  let streak = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (days[index]?.count === 0) break;
    streak += 1;
  }
  return streak;
}

function countLongestStreak(days: readonly ActivityDay[]): number {
  let longest = 0;
  let current = 0;
  for (const day of days) {
    if (day.count === 0) {
      current = 0;
      continue;
    }
    current += 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

function graphPointForDay(day: ActivityDay): LivelinePoint {
  return {
    time: Math.floor(startOfLocalDay(new Date(`${day.key}T00:00:00`)).getTime() / 1000),
    value: day.count,
  };
}

function eventsForSession(
  events: readonly AgentRuntimeEvent[],
  runtimeSessionId: string,
): AgentRuntimeEvent[] {
  return events.filter((event) => event.runtimeSessionId === runtimeSessionId);
}

function deriveUsageSummary(snapshot: MultiRuntimeHostSnapshot): UsageSummary {
  const countsByDay = new Map<string, number>();

  for (const event of snapshot.runtimeEvents) {
    incrementActivity(countsByDay, event.createdAt);
  }

  const sessionSummaries = snapshot.sessionTrees.map((tree): UsageSessionSummary => {
    const entries = tree.entries;
    const sessionEvents = eventsForSession(snapshot.runtimeEvents, tree.runtimeSessionId);
    const userTurns = entries.filter((entry) => entry.role === "user").length;
    const messageCount = entries.filter((entry) => entry.kind === "message").length;
    const toolRuns = sessionEvents.filter((event) => event.type === "tool.completed").length;

    for (const entry of entries) {
      incrementActivity(countsByDay, entry.createdAt);
    }

    const entryDates = entries.map((entry) => entry.createdAt);
    const eventDates = sessionEvents.map((event) => event.createdAt);
    const dates = [...entryDates, ...eventDates];
    const startedAt = dates.reduce(earlierIso, dates[0] ?? new Date().toISOString());
    const updatedAt = dates.reduce(laterIso, dates[0] ?? startedAt);
    const durationMs = Math.max(0, timestampMs(updatedAt) - timestampMs(startedAt));

    return {
      runtimeSessionId: tree.runtimeSessionId,
      title: sessionTitle(entries, "Agent thread"),
      updatedAt,
      durationMs,
      userTurns,
      toolRuns,
      messageCount,
      eventCount: sessionEvents.length,
    };
  });
  const recentSessions = sessionSummaries
    .sort((left, right) => timestampMs(right.updatedAt) - timestampMs(left.updatedAt))
    .slice(0, RECENT_SESSION_LIMIT);

  const heatmapDays = buildDays(HEATMAP_DAYS, countsByDay);
  const graphDays = buildDays(GRAPH_DAYS, countsByDay);
  const graphPoints = graphDays.map(graphPointForDay);
  const graphValue = graphPoints.at(-1)?.value ?? 0;
  const maxHeatmapCount = Math.max(...heatmapDays.map((day) => day.count), 0);
  const longestSessionMs = Math.max(...sessionSummaries.map((session) => session.durationMs), 0);

  return {
    totalSessions: snapshot.sessionTrees.length,
    longestSessionMs,
    longestStreakDays: countLongestStreak(heatmapDays),
    currentStreakDays: countCurrentStreak(heatmapDays),
    heatmapDays,
    graphPoints,
    graphValue,
    recentSessions,
    maxHeatmapCount,
  };
}

function heatmapCellClass(count: number, maxCount: number): string {
  if (count === 0 || maxCount === 0) {
    return "bg-multi-bg-tertiary";
  }
  const intensity = count / maxCount;
  if (intensity > 0.75) return "bg-orange-500";
  if (intensity > 0.45) return "bg-orange-400";
  if (intensity > 0.2) return "bg-orange-300";
  return "bg-orange-200";
}

function UsageStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-t border-multi-stroke-quaternary px-3 py-2.5 first:border-t-0 sm:border-t-0 sm:border-l sm:first:border-l-0">
      <Text render={<div />} size="xl" tone="primary" weight="medium" className="tabular-nums">
        {value}
      </Text>
      <Text render={<div />} size="sm" tone="tertiary" className="mt-0.5 truncate">
        {label}
      </Text>
    </div>
  );
}

function UsageOverview({ summary }: { summary: UsageSummary }) {
  return (
    <SettingsSection title="Overview">
      <div className="grid sm:grid-cols-4">
        <UsageStat label="Longest session" value={formatDuration(summary.longestSessionMs)} />
        <UsageStat label="Sessions" value={formatCount(summary.totalSessions)} />
        <UsageStat label="Longest streak" value={`${formatCount(summary.longestStreakDays)}d`} />
        <UsageStat label="Current streak" value={`${formatCount(summary.currentStreakDays)}d`} />
      </div>
    </SettingsSection>
  );
}

function UsageGraph({ summary, theme }: { summary: UsageSummary; theme: "light" | "dark" }) {
  return (
    <SettingsSection title="Activity">
      <div className="border-t border-multi-stroke-quaternary px-3 py-3 first:border-t-0">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Text render={<div />} size="lg" tone="primary" weight="medium">
              Daily activity
            </Text>
            <Text render={<p />} size="base" tone="tertiary">
              Pi session entries and runtime events from the last 30 days.
            </Text>
          </div>
          <Text
            render={<div />}
            size="xl"
            tone="primary"
            weight="medium"
            className="shrink-0 tabular-nums"
          >
            {formatCount(summary.graphValue)}
          </Text>
        </div>
        <div className="h-52 overflow-hidden rounded-md border border-multi-stroke-quaternary bg-multi-bg-primary">
          <Liveline
            data={summary.graphPoints}
            value={summary.graphValue}
            theme={theme}
            color="#10b981"
            window={GRAPH_DAYS * DAY_SECONDS}
            badge={false}
            fill
            grid
            pulse={false}
            scrub
            exaggerate
            emptyText="No usage data"
            formatValue={(value) => formatCount(value)}
            formatTime={(time) => DAY_LABEL_FORMATTER.format(new Date(time * 1000))}
            padding={{ top: 12, right: 16, bottom: 28, left: 12 }}
          />
        </div>
      </div>
      <div className="border-t border-multi-stroke-quaternary px-3 py-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <Text render={<div />} size="lg" tone="primary" weight="medium">
            Heatmap
          </Text>
          <Text render={<div />} size="sm" tone="tertiary">
            Last 12 weeks
          </Text>
        </div>
        <div className="grid w-max grid-flow-col grid-rows-7 gap-1 [grid-auto-columns:9px] [grid-template-rows:repeat(7,9px)]">
          {summary.heatmapDays.map((day) => (
            <div
              key={day.key}
              title={`${day.label}: ${formatCount(day.count)} activity item${
                day.count === 1 ? "" : "s"
              }`}
              aria-label={`${day.label}: ${formatCount(day.count)} activity items`}
              className={cn(
                "size-[9px] rounded-full",
                heatmapCellClass(day.count, summary.maxHeatmapCount),
              )}
            />
          ))}
        </div>
      </div>
    </SettingsSection>
  );
}

function RecentSessions({ sessions }: { sessions: readonly UsageSessionSummary[] }) {
  return (
    <SettingsSection title="Recent sessions">
      {sessions.length === 0 ? (
        <div className="px-3 py-6 text-center">
          <Text render={<p />} size="base" tone="tertiary">
            No Pi sessions yet.
          </Text>
        </div>
      ) : (
        sessions.map((session) => (
          <div
            key={session.runtimeSessionId}
            className="border-t border-multi-stroke-quaternary px-3 py-2.5 first:border-t-0"
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <div
                  className={cn(
                    textVariants({ size: "lg", tone: "primary", weight: "medium" }),
                    "truncate",
                  )}
                >
                  {session.title}
                </div>
                <Text render={<div />} size="sm" tone="tertiary" className="mt-0.5">
                  {DATE_TIME_FORMATTER.format(new Date(session.updatedAt))}
                </Text>
              </div>
              <Text
                render={<div />}
                size="sm"
                tone="tertiary"
                className="shrink-0 text-right tabular-nums"
              >
                {formatCount(session.userTurns)} turns
              </Text>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              <Text render={<span />} size="sm" tone="tertiary" className="tabular-nums">
                {formatCount(session.messageCount)} messages
              </Text>
              <Text render={<span />} size="sm" tone="tertiary" className="tabular-nums">
                {formatCount(session.toolRuns)} tools
              </Text>
              <Text render={<span />} size="sm" tone="tertiary" className="tabular-nums">
                {formatCount(session.eventCount)} events
              </Text>
            </div>
          </div>
        ))
      )}
    </SettingsSection>
  );
}

export function UsageSettingsPanel() {
  const snapshot = useAgentRuntimeStore((state) => state.snapshot);
  const { resolvedTheme } = useTheme();
  const summary = useMemo(() => deriveUsageSummary(snapshot), [snapshot]);

  return (
    <SettingsPageContainer>
      <UsageOverview summary={summary} />
      <UsageGraph summary={summary} theme={resolvedTheme} />
      <RecentSessions sessions={summary.recentSessions} />
    </SettingsPageContainer>
  );
}
