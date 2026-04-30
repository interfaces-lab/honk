import {
  PROVIDER_DISPLAY_NAMES,
  type OrchestrationThreadActivity,
  type ProviderKind,
} from "@multi/contracts";
import { PROVIDER_NOTICE_KIND, type ProviderNoticeKind } from "~/lib/ui-session-types";

export interface ProviderNotice {
  id: string;
  at: string;
  kind: ProviderNoticeKind;
  provider: ProviderKind;
  level: "warning" | "error";
  title: string;
  detail: string | null;
  until: string | null;
  raw: unknown;
}

export interface ProviderNoticeForce {
  seq: number;
  kind: ProviderNoticeKind;
  provider: ProviderKind | null;
}

function obj(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const next = value.trim();
  if (next.length === 0) {
    return null;
  }
  return next;
}

function iso(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) {
    return null;
  }
  return new Date(stamp).toISOString();
}

function label(provider: ProviderKind): string {
  return PROVIDER_DISPLAY_NAMES[provider];
}

function level(kind: ProviderNoticeKind): "warning" | "error" {
  if (kind === PROVIDER_NOTICE_KIND.auth) {
    return "error";
  }
  return "warning";
}

function rank(kind: ProviderNoticeKind): number {
  if (kind === PROVIDER_NOTICE_KIND.rateLimit) {
    return 0;
  }
  if (kind === PROVIDER_NOTICE_KIND.auth) {
    return 1;
  }
  return 2;
}

function rateRejected(value: unknown): boolean | null {
  const raw = obj(value);
  if (!raw) {
    return null;
  }

  const info = obj(raw.rate_limit_info) ?? raw;
  const status = str(info?.status);
  if (status === "rejected") {
    return true;
  }
  if (status === "allowed" || status === "allowed_warning") {
    return false;
  }
  return null;
}

function note(activity: OrchestrationThreadActivity, now: number): ProviderNotice | null {
  const payload = obj(activity.payload);
  const provider = payload?.provider;
  if (provider !== "codex" && provider !== "claudeAgent") {
    return null;
  }

  if (
    activity.kind !== PROVIDER_NOTICE_KIND.rateLimit &&
    activity.kind !== PROVIDER_NOTICE_KIND.auth &&
    activity.kind !== PROVIDER_NOTICE_KIND.config
  ) {
    return null;
  }

  const raw = payload?.raw ?? activity.payload;
  if (activity.kind === PROVIDER_NOTICE_KIND.rateLimit && rateRejected(raw) === false) {
    return null;
  }

  const until = iso(payload?.until);
  if (activity.kind === PROVIDER_NOTICE_KIND.rateLimit && until) {
    const stamp = Date.parse(until);
    if (!Number.isFinite(stamp) || stamp <= now) {
      return null;
    }
  }

  if (activity.kind === PROVIDER_NOTICE_KIND.rateLimit && until === null) {
    const stamp = Date.parse(activity.createdAt);
    if (Number.isFinite(stamp) && stamp + 30_000 <= now) {
      return null;
    }
  }

  const title = str(payload?.title) ?? activity.summary;
  return {
    id: activity.id,
    at: activity.createdAt,
    kind: activity.kind,
    provider,
    level:
      payload?.level === "error" || payload?.level === "warning"
        ? payload.level
        : level(activity.kind),
    title,
    detail: str(payload?.detail),
    until,
    raw,
  };
}

function forced(input: { force: ProviderNoticeForce; provider: ProviderKind | null; now: number }) {
  const provider = input.force.provider ?? input.provider ?? "claudeAgent";
  const title =
    input.force.kind === PROVIDER_NOTICE_KIND.rateLimit
      ? `${label(provider)} rate limit reached`
      : input.force.kind === PROVIDER_NOTICE_KIND.auth
        ? `${label(provider)} authentication issue`
        : `${label(provider)} configuration warning`;
  const detail =
    input.force.kind === PROVIDER_NOTICE_KIND.rateLimit
      ? `${label(provider)} is currently rate limited for this thread.`
      : input.force.kind === PROVIDER_NOTICE_KIND.auth
        ? `${label(provider)} needs attention before this thread can continue.`
        : `${label(provider)} reported a configuration warning for this thread.`;
  return {
    id: `dev:${input.force.kind}:${String(input.force.seq)}`,
    at: new Date(input.now).toISOString(),
    kind: input.force.kind,
    provider,
    level: level(input.force.kind),
    title,
    detail,
    until:
      input.force.kind === PROVIDER_NOTICE_KIND.rateLimit
        ? new Date(input.now + 5 * 60_000).toISOString()
        : null,
    raw: {
      dev: true,
      provider,
      kind: input.force.kind,
    },
  } satisfies ProviderNotice;
}

export function deriveProviderNotice(input: {
  activities: readonly OrchestrationThreadActivity[];
  provider: ProviderKind | null;
  force?: ProviderNoticeForce | null;
  now?: number;
}): ProviderNotice | null {
  const now = input.now ?? Date.now();
  if (input.force) {
    return forced({ force: input.force, provider: input.provider, now });
  }

  const notes = input.activities
    .flatMap((activity) => {
      const item = note(activity, now);
      return item ? [item] : [];
    })
    .toSorted((left, right) => {
      const a = rank(left.kind);
      const b = rank(right.kind);
      if (a !== b) {
        return a - b;
      }
      if (left.at < right.at) {
        return 1;
      }
      if (left.at > right.at) {
        return -1;
      }
      return left.id < right.id ? 1 : -1;
    });
  return notes[0] ?? null;
}

export function formatNoticeWait(until: string, now = Date.now()): string | null {
  const left = Date.parse(until) - now;
  if (!Number.isFinite(left) || left <= 0) {
    return null;
  }

  const sec = Math.max(1, Math.ceil(left / 1_000));
  if (sec < 60) {
    return `${String(sec)}s`;
  }

  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) {
    if (rem === 0) {
      return `${String(min)}m`;
    }
    return `${String(min)}m ${String(rem)}s`;
  }

  const hr = Math.floor(min / 60);
  const rest = min % 60;
  if (rest === 0) {
    return `${String(hr)}h`;
  }
  return `${String(hr)}h ${String(rest)}m`;
}
