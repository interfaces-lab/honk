export interface SubagentBudgetLimits {
  readonly maxTasksPerToolCall: number;
  readonly maxActivePerToolCall: number;
  readonly maxActivePerSession: number;
  readonly maxLoadedIdleChildren: number;
  readonly maxParentVisibleOutputBytesPerRun: number;
  readonly maxParentVisibleOutputBytesPerToolCall: number;
  readonly profileActiveLimits: Readonly<Record<string, number>>;
}

export interface SubagentBudgetSnapshot {
  readonly activeTotal: number;
  readonly queuedTotal: number;
  readonly activeBySession: Readonly<Record<string, number>>;
  readonly activeByToolCall: Readonly<Record<string, number>>;
  readonly activeByProfile: Readonly<Record<string, number>>;
  readonly limits: SubagentBudgetLimits;
}

export interface SubagentBudgetLease {
  readonly release: () => void;
}

export interface SubagentBudgetAcquireInput {
  readonly parentSessionId: string;
  readonly toolCallId: string;
  readonly profileName: string;
  readonly signal?: AbortSignal | undefined;
}

export interface SubagentBudgetController {
  readonly canAcceptTaskCount: (taskCount: number) => boolean;
  readonly acquireSlot: (input: SubagentBudgetAcquireInput) => Promise<SubagentBudgetLease>;
  readonly snapshot: () => SubagentBudgetSnapshot;
}

export interface LoadedSubagentRuntime {
  active: boolean;
  disposed: boolean;
  lastUsedAt: number;
  dispose: () => void;
}

export const DEFAULT_SUBAGENT_BUDGET_LIMITS: SubagentBudgetLimits = {
  maxTasksPerToolCall: 20,
  maxActivePerToolCall: 4,
  maxActivePerSession: 4,
  maxLoadedIdleChildren: 5,
  maxParentVisibleOutputBytesPerRun: 50 * 1024,
  maxParentVisibleOutputBytesPerToolCall: 200 * 1024,
  profileActiveLimits: {
    "general-purpose": 4,
    librarian: 4,
    oracle: 4,
  },
};

interface PendingBudgetRequest {
  readonly input: SubagentBudgetAcquireInput;
  readonly resolve: (lease: SubagentBudgetLease) => void;
  readonly reject: (error: Error) => void;
  abortListener: (() => void) | null;
}

export function createSubagentBudgetController(
  limits: SubagentBudgetLimits = DEFAULT_SUBAGENT_BUDGET_LIMITS,
): SubagentBudgetController {
  const activeBySession = new Map<string, number>();
  const activeByToolCall = new Map<string, number>();
  const activeByProfile = new Map<string, number>();
  const queue: PendingBudgetRequest[] = [];

  const canAcceptTaskCount = (taskCount: number): boolean => {
    return Number.isInteger(taskCount) && taskCount >= 0 && taskCount <= limits.maxTasksPerToolCall;
  };

  const hasCapacity = (input: SubagentBudgetAcquireInput): boolean => {
    const profileLimit = limits.profileActiveLimits[input.profileName] ?? limits.maxActivePerSession;
    return (
      countOf(activeByToolCall, input.toolCallId) < limits.maxActivePerToolCall &&
      countOf(activeBySession, input.parentSessionId) < limits.maxActivePerSession &&
      countOf(activeByProfile, input.profileName) < profileLimit
    );
  };

  const releaseSlot = (input: SubagentBudgetAcquireInput): void => {
    decrementCount(activeBySession, input.parentSessionId);
    decrementCount(activeByToolCall, input.toolCallId);
    decrementCount(activeByProfile, input.profileName);
    drainQueue();
  };

  const grant = (request: PendingBudgetRequest): void => {
    if (request.abortListener) {
      request.input.signal?.removeEventListener("abort", request.abortListener);
    }
    incrementCount(activeBySession, request.input.parentSessionId);
    incrementCount(activeByToolCall, request.input.toolCallId);
    incrementCount(activeByProfile, request.input.profileName);
    let released = false;
    request.resolve({
      release: () => {
        if (released) {
          return;
        }
        released = true;
        releaseSlot(request.input);
      },
    });
  };

  const removeQueuedRequest = (request: PendingBudgetRequest): boolean => {
    const index = queue.indexOf(request);
    if (index === -1) {
      return false;
    }
    queue.splice(index, 1);
    return true;
  };

  function drainQueue(): void {
    let grantedAny = true;
    while (grantedAny) {
      grantedAny = false;
      for (const request of [...queue]) {
        if (request.input.signal?.aborted) {
          if (removeQueuedRequest(request)) {
            request.reject(new Error("Subagent aborted while waiting for a budget slot."));
          }
          continue;
        }
        if (!hasCapacity(request.input)) {
          continue;
        }
        if (removeQueuedRequest(request)) {
          grant(request);
          grantedAny = true;
        }
      }
    }
  }

  return {
    canAcceptTaskCount,
    acquireSlot(input) {
      if (input.signal?.aborted) {
        return Promise.reject(new Error("Subagent aborted while waiting for a budget slot."));
      }
      return new Promise((resolve, reject) => {
        const request: PendingBudgetRequest = {
          input,
          resolve,
          reject,
          abortListener: null,
        };
        request.abortListener = () => {
          if (removeQueuedRequest(request)) {
            reject(new Error("Subagent aborted while waiting for a budget slot."));
            drainQueue();
          }
        };
        input.signal?.addEventListener("abort", request.abortListener, { once: true });
        queue.push(request);
        drainQueue();
      });
    },
    snapshot() {
      return {
        activeTotal: [...activeBySession.values()].reduce((total, count) => total + count, 0),
        queuedTotal: queue.length,
        activeBySession: recordFromCountMap(activeBySession),
        activeByToolCall: recordFromCountMap(activeByToolCall),
        activeByProfile: recordFromCountMap(activeByProfile),
        limits,
      };
    },
  };
}

export function truncateSubagentOutputForParent(input: {
  readonly text: string;
  readonly maxBytes: number;
}): string {
  const maxBytes = Math.max(0, input.maxBytes);
  if (byteLength(input.text) <= maxBytes) {
    return input.text;
  }

  const suffix = "\n\n[Output truncated. Open the subagent transcript for full details.]";
  const suffixBytes = byteLength(suffix);
  if (suffixBytes >= maxBytes) {
    return truncateUtf8ToMaxBytes(suffix, maxBytes);
  }

  return `${truncateUtf8ToMaxBytes(input.text, maxBytes - suffixBytes)}${suffix}`;
}

export function evictIdleSubagentRuntimes(input: {
  readonly loadedChildren: Map<string, LoadedSubagentRuntime>;
  readonly maxLoadedIdleChildren: number;
}): void {
  const idleChildren = [...input.loadedChildren.entries()]
    .filter(([, child]) => !child.active && !child.disposed)
    .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt);

  while (idleChildren.length > input.maxLoadedIdleChildren) {
    const [id, child] = idleChildren.shift() ?? [];
    if (!id || !child || child.disposed) {
      continue;
    }
    child.disposed = true;
    child.dispose();
    input.loadedChildren.delete(id);
  }
}

export function disposeLoadedSubagentRuntimes(
  loadedChildren: Map<string, LoadedSubagentRuntime>,
): void {
  for (const child of loadedChildren.values()) {
    if (child.disposed) {
      continue;
    }
    child.disposed = true;
    child.dispose();
  }
  loadedChildren.clear();
}

function countOf(map: ReadonlyMap<string, number>, key: string): number {
  return map.get(key) ?? 0;
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, countOf(map, key) + 1);
}

function decrementCount(map: Map<string, number>, key: string): void {
  const next = countOf(map, key) - 1;
  if (next <= 0) {
    map.delete(key);
    return;
  }
  map.set(key, next);
}

function recordFromCountMap(map: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries(map.entries());
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function truncateUtf8ToMaxBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return "";
  }
  let next = text.slice(0, maxBytes);
  while (byteLength(next) > maxBytes) {
    next = next.slice(0, -1);
  }
  return next;
}
