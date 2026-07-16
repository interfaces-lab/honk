import {
  OPEN_CODE_LOCAL_SESSION_TARGET,
  normalizeOpenCodeSessionTarget,
  openCodeLocationRef,
  openCodeServerKey,
  openCodeSessionKey,
  openCodeSessionRef,
  sameOpenCodeSessionTarget,
  type OpenCodeServerKey,
  type OpenCodeSessionRef,
  type OpenCodeLocationRef,
  type OpenCodeSessionTarget,
  type OpenCodeSessionInfo,
} from "@honk/opencode";

import { Option, Schema } from "effect";

const OPEN_CODE_TAB_SCHEMA = "honk.opencode.window-tabs";
const OPEN_CODE_TAB_VERSION = 4;
const OPEN_CODE_CLOSED_TAB_LIMIT = 25;
const OPEN_CODE_DRAFT_KEY_PREFIX = "opencode:draft:";

declare const openCodeTabKeyBrand: unique symbol;

type OpenCodeTabKey = string & {
  readonly [openCodeTabKeyBrand]: "OpenCodeTabKey";
};

type OpenCodeSessionTab = {
  readonly type: "session";
  readonly server: OpenCodeServerKey;
  readonly sessionID: string;
};

type OpenCodeDraftTab = {
  readonly type: "draft";
  readonly draftID: string;
  readonly server: OpenCodeServerKey;
  readonly location: OpenCodeLocationRef;
  readonly target: OpenCodeSessionTarget;
};

type OpenCodeTab = OpenCodeSessionTab | OpenCodeDraftTab;

type OpenCodeTabInfo = {
  readonly title?: string;
  readonly directory?: string;
  /** Last resolved route for the session tab, including its workbench island state. */
  readonly route?: string;
};

type OpenCodeClosedTab = {
  readonly tab: OpenCodeSessionTab;
  readonly index: number;
};

type OpenCodeTabState = {
  readonly schema: typeof OPEN_CODE_TAB_SCHEMA;
  readonly version: typeof OPEN_CODE_TAB_VERSION;
  readonly tabs: readonly OpenCodeTab[];
  /** `null` selects Home. */
  readonly activeKey: OpenCodeTabKey | null;
  /** Last selected non-Home tab. */
  readonly recentKey: OpenCodeTabKey | null;
  readonly info: Readonly<Record<string, OpenCodeTabInfo>>;
  readonly closed: readonly OpenCodeClosedTab[];
};

type OpenCodeDraftInput = {
  readonly draftID: string;
  readonly server: OpenCodeServerKey;
  readonly location: OpenCodeLocationRef;
  readonly target?: OpenCodeSessionTarget;
};

type OpenCodeTabTransition = {
  readonly state: OpenCodeTabState;
  /** Draft state IDs that the caller must delete. */
  readonly discardedDraftIDs: readonly string[];
};

const NO_DISCARDED_DRAFTS: readonly string[] = Object.freeze([]);

function createOpenCodeTabState(): OpenCodeTabState {
  return freezeState({
    tabs: [],
    activeKey: null,
    recentKey: null,
    info: {},
    closed: [],
  });
}

function openCodeTabKey(tab: OpenCodeTab): OpenCodeTabKey {
  if (tab.type === "draft") {
    return openCodeDraftTabKey(tab.draftID);
  }
  const key: string = openCodeSessionKey(openCodeSessionRef(tab.server, tab.sessionID));
  return key as OpenCodeTabKey;
}

function openCodeDraftTabKey(draftID: string): OpenCodeTabKey {
  return `${OPEN_CODE_DRAFT_KEY_PREFIX}${encodeURIComponent(
    requireIdentifier(draftID, "draft ID"),
  )}` as OpenCodeTabKey;
}

function openCodeDraftIDFromTabKey(value: string): string | null {
  if (!value.startsWith(OPEN_CODE_DRAFT_KEY_PREFIX)) return null;
  const encoded = value.slice(OPEN_CODE_DRAFT_KEY_PREFIX.length);
  if (encoded.length === 0) return null;
  try {
    const draftID = decodeURIComponent(encoded);
    return openCodeDraftTabKey(draftID) === value ? draftID : null;
  } catch {
    return null;
  }
}

function openCodeSessionTab(ref: OpenCodeSessionRef): OpenCodeSessionTab {
  return Object.freeze({
    type: "session",
    server: ref.server,
    sessionID: ref.sessionID,
  });
}

function openCodeSessionTabKey(ref: OpenCodeSessionRef): OpenCodeTabKey {
  return openCodeTabKey(openCodeSessionTab(ref));
}

function openCodeTabSessionRef(tab: OpenCodeTab): OpenCodeSessionRef | null {
  return tab.type === "draft" ? null : openCodeSessionRef(tab.server, tab.sessionID);
}

function openCodeDraftTab(input: OpenCodeDraftInput): OpenCodeDraftTab {
  const draftID = requireIdentifier(input.draftID, "draft ID");
  return Object.freeze({
    type: "draft",
    draftID,
    server: input.server,
    location: openCodeLocationRef(input.location),
    target: normalizeOpenCodeSessionTarget(input.target ?? OPEN_CODE_LOCAL_SESSION_TARGET),
  });
}

function addOpenCodeSessionTab(
  state: OpenCodeTabState,
  ref: OpenCodeSessionRef,
  options?: { readonly activate?: boolean },
): OpenCodeTabState {
  const tab = openCodeSessionTab(ref);
  const key = openCodeTabKey(tab);
  const exists = state.tabs.some((candidate) => openCodeTabKey(candidate) === key);
  const activate = options?.activate !== false;

  if (exists) {
    return activate ? selectOpenCodeTab(state, key) : state;
  }

  return freezeState({
    ...state,
    tabs: [...state.tabs, tab],
    activeKey: activate ? key : state.activeKey,
    recentKey: activate ? key : state.recentKey,
  });
}

function addOpenCodeDraftTab(
  state: OpenCodeTabState,
  input: OpenCodeDraftInput,
  options?: { readonly activate?: boolean },
): OpenCodeTabState {
  const tab = openCodeDraftTab(input);
  const key = openCodeTabKey(tab);
  const exists = state.tabs.some((candidate) => openCodeTabKey(candidate) === key);
  const activate = options?.activate !== false;

  if (exists) {
    return activate ? selectOpenCodeTab(state, key) : state;
  }

  return freezeState({
    ...state,
    tabs: [...state.tabs, tab],
    activeKey: activate ? key : state.activeKey,
    recentKey: activate ? key : state.recentKey,
  });
}

function updateOpenCodeDraftTab(
  state: OpenCodeTabState,
  draftID: string,
  update: {
    readonly server?: OpenCodeServerKey;
    readonly location?: OpenCodeLocationRef;
    readonly target?: OpenCodeSessionTarget;
  },
): OpenCodeTabState {
  const index = state.tabs.findIndex((tab) => tab.type === "draft" && tab.draftID === draftID);
  const current = index >= 0 ? state.tabs[index] : undefined;
  if (current === undefined || current.type !== "draft") {
    return state;
  }

  const next = openCodeDraftTab({
    draftID: current.draftID,
    server: update.server ?? current.server,
    location: update.location ?? current.location,
    target: update.target ?? current.target,
  });
  if (
    next.server === current.server &&
    next.location.directory === current.location.directory &&
    next.location.workspaceID === current.location.workspaceID &&
    sameOpenCodeSessionTarget(next.target, current.target)
  ) {
    return state;
  }

  const tabs = [...state.tabs];
  tabs[index] = next;
  return freezeState({ ...state, tabs });
}

function selectOpenCodeTab(state: OpenCodeTabState, key: OpenCodeTabKey): OpenCodeTabState {
  if (!state.tabs.some((tab) => openCodeTabKey(tab) === key)) {
    return state;
  }
  if (state.activeKey === key && state.recentKey === key) {
    return state;
  }
  return freezeState({ ...state, activeKey: key, recentKey: key });
}

function showOpenCodeHome(state: OpenCodeTabState): OpenCodeTabState {
  if (state.activeKey === null) {
    return state;
  }
  return freezeState({ ...state, activeKey: null });
}

function toggleOpenCodeHome(state: OpenCodeTabState): OpenCodeTabState {
  if (state.activeKey !== null) {
    return showOpenCodeHome(state);
  }
  if (state.recentKey === null) {
    return state;
  }
  return selectOpenCodeTab(state, state.recentKey);
}

function reorderOpenCodeTabs(
  state: OpenCodeTabState,
  keys: readonly OpenCodeTabKey[],
): OpenCodeTabState {
  if (keys.length !== state.tabs.length) {
    return state;
  }

  const byKey = new Map(state.tabs.map((tab) => [openCodeTabKey(tab), tab]));
  const seen = new Set<OpenCodeTabKey>();
  const tabs: OpenCodeTab[] = [];
  for (const key of keys) {
    const tab = byKey.get(key);
    if (tab === undefined || seen.has(key)) {
      return state;
    }
    seen.add(key);
    tabs.push(tab);
  }

  if (tabs.length === state.tabs.length && tabs.every((tab, index) => tab === state.tabs[index])) {
    return state;
  }
  return freezeState({ ...state, tabs });
}

function closeOpenCodeTab(state: OpenCodeTabState, key: OpenCodeTabKey): OpenCodeTabTransition {
  const index = state.tabs.findIndex((tab) => openCodeTabKey(tab) === key);
  const tab = index >= 0 ? state.tabs[index] : undefined;
  if (tab === undefined) {
    return unchanged(state);
  }

  const tabs = state.tabs.filter((candidate) => candidate !== tab);
  const fallbackKey = neighborKeyAfterRemoval(state.tabs, index, new Set([key]));
  const closed =
    tab.type === "draft"
      ? state.closed
      : [...state.closed, Object.freeze({ tab, index })].slice(-OPEN_CODE_CLOSED_TAB_LIMIT);

  return transition(
    freezeState({
      ...state,
      tabs,
      activeKey: state.activeKey === key ? fallbackKey : state.activeKey,
      recentKey: state.recentKey === key ? fallbackKey : state.recentKey,
      info: pruneSessionInfo(state.info, tabs),
      closed,
    }),
    tab.type === "draft" ? [tab.draftID] : NO_DISCARDED_DRAFTS,
  );
}

function reopenClosedOpenCodeTab(state: OpenCodeTabState): OpenCodeTabTransition {
  const closed = [...state.closed];
  const open = new Set(state.tabs.map(openCodeTabKey));
  let entry: OpenCodeClosedTab | undefined;

  while (closed.length > 0) {
    const candidate = closed.pop();
    if (candidate !== undefined && !open.has(openCodeTabKey(candidate.tab))) {
      entry = candidate;
      break;
    }
  }

  if (entry === undefined) {
    return closed.length === state.closed.length
      ? unchanged(state)
      : transition(freezeState({ ...state, closed }), NO_DISCARDED_DRAFTS);
  }

  const key = openCodeTabKey(entry.tab);
  const tabs = [...state.tabs];
  tabs.splice(Math.min(Math.max(entry.index, 0), tabs.length), 0, entry.tab);
  return transition(
    freezeState({
      ...state,
      tabs,
      activeKey: key,
      recentKey: key,
      closed,
    }),
    NO_DISCARDED_DRAFTS,
  );
}

function promoteOpenCodeDraft(
  state: OpenCodeTabState,
  draftID: string,
  ref: OpenCodeSessionRef,
  session?: Pick<OpenCodeSessionInfo, "title" | "location">,
): OpenCodeTabTransition {
  const index = state.tabs.findIndex((tab) => tab.type === "draft" && tab.draftID === draftID);
  const draft = index >= 0 ? state.tabs[index] : undefined;
  if (draft === undefined || draft.type !== "draft") {
    return unchanged(state);
  }

  const draftKey = openCodeTabKey(draft);
  const next = openCodeSessionTab(ref);
  const nextKey = openCodeTabKey(next);
  const existingIndex = state.tabs.findIndex(
    (tab, candidateIndex) => candidateIndex !== index && openCodeTabKey(tab) === nextKey,
  );
  const tabs = [...state.tabs];
  if (existingIndex >= 0) {
    tabs.splice(index, 1);
  } else {
    tabs[index] = next;
  }

  let info = withoutInfo(state.info, new Set([draftKey]));
  if (session !== undefined) {
    info = withInfo(info, nextKey, sessionInfo(session));
  }

  return transition(
    freezeState({
      ...state,
      tabs,
      activeKey: state.activeKey === draftKey ? nextKey : state.activeKey,
      recentKey: state.recentKey === draftKey ? nextKey : state.recentKey,
      info,
      closed: state.closed.filter((entry) => openCodeTabKey(entry.tab) !== nextKey),
    }),
    [draft.draftID],
  );
}

function removeOpenCodeSessions(
  state: OpenCodeTabState,
  server: OpenCodeServerKey,
  sessionIDs: readonly string[],
): OpenCodeTabTransition {
  const removedSessionIDs = new Set(sessionIDs);
  return removeMatchingTabs(
    state,
    (tab) => tab.server === server && tab.type !== "draft" && removedSessionIDs.has(tab.sessionID),
    (entry) => entry.tab.server === server && removedSessionIDs.has(entry.tab.sessionID),
  );
}

function removeOpenCodeServer(
  state: OpenCodeTabState,
  server: OpenCodeServerKey,
): OpenCodeTabTransition {
  return removeMatchingTabs(
    state,
    (tab) => tab.server === server,
    (entry) => entry.tab.server === server,
  );
}

function rememberOpenCodeSessionInfo(
  state: OpenCodeTabState,
  ref: OpenCodeSessionRef,
  session: Pick<OpenCodeSessionInfo, "title" | "location">,
): OpenCodeTabState {
  const key = openCodeSessionTabKey(ref);
  const isOpen = state.tabs.some((tab) => {
    const owner = openCodeTabSessionRef(tab);
    return owner?.server === ref.server && owner.sessionID === ref.sessionID;
  });
  if (!isOpen) {
    return state;
  }

  const current = state.info[key];
  const next = Object.freeze({ ...current, ...sessionInfo(session) });
  if (
    current?.title === next.title &&
    current?.directory === next.directory &&
    current?.route === next.route
  ) {
    return state;
  }
  return freezeState({ ...state, info: withInfo(state.info, key, next) });
}

function rememberOpenCodeSessionRoute(
  state: OpenCodeTabState,
  ref: OpenCodeSessionRef,
  route: string,
): OpenCodeTabState {
  const key = openCodeSessionTabKey(ref);
  const isOpen = state.tabs.some((tab) => {
    const owner = openCodeTabSessionRef(tab);
    return owner?.server === ref.server && owner.sessionID === ref.sessionID;
  });
  const normalized = route.trim();
  if (!isOpen || normalized.length === 0 || state.info[key]?.route === normalized) {
    return state;
  }
  return freezeState({
    ...state,
    info: withInfo(state.info, key, Object.freeze({ ...state.info[key], route: normalized })),
  });
}

function serializeOpenCodeTabState(state: OpenCodeTabState): string {
  return JSON.stringify(state);
}

// Decode the JSON shape first. parseTab then validates branded values with the constructors.
const OpenCodePersistedTargetSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("local") }),
  Schema.Struct({ type: Schema.Literal("new-workspace") }),
  Schema.Struct({
    type: Schema.Literal("workspace"),
    location: Schema.Struct({
      directory: Schema.String,
      workspaceID: Schema.optional(Schema.String),
    }),
  }),
]);

const OpenCodePersistedTabSchema = Schema.Union([
  Schema.Struct({
    server: Schema.String,
    type: Schema.Literal("session"),
    sessionID: Schema.String,
  }),
  Schema.Struct({
    server: Schema.String,
    type: Schema.Literal("draft"),
    draftID: Schema.String,
    location: Schema.Struct({
      directory: Schema.String,
      workspaceID: Schema.optional(Schema.String),
    }),
    target: Schema.optional(OpenCodePersistedTargetSchema),
  }),
]);

const OpenCodePersistedInfoSchema = Schema.Struct({
  title: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.String),
  route: Schema.optional(Schema.String),
});

const OpenCodePersistedClosedSchema = Schema.Struct({
  tab: Schema.optional(Schema.Unknown),
  index: Schema.Int,
});

const OpenCodePersistedStateSchema = Schema.Struct({
  schema: Schema.Literal(OPEN_CODE_TAB_SCHEMA),
  version: Schema.Literals([1, 2, 3, OPEN_CODE_TAB_VERSION]),
  tabs: Schema.Array(Schema.Unknown),
  closed: Schema.Array(Schema.Unknown),
  info: Schema.Record(Schema.String, Schema.Unknown),
  activeKey: Schema.optional(Schema.Unknown),
  recentKey: Schema.optional(Schema.Unknown),
});

const decodeOpenCodePersistedTab = Schema.decodeUnknownOption(OpenCodePersistedTabSchema);
const decodeOpenCodePersistedInfo = Schema.decodeUnknownOption(OpenCodePersistedInfoSchema);
const decodeOpenCodePersistedClosed = Schema.decodeUnknownOption(OpenCodePersistedClosedSchema);
const decodeOpenCodePersistedState = Schema.decodeUnknownOption(OpenCodePersistedStateSchema);

function hydrateOpenCodeTabState(raw: string | null): OpenCodeTabState {
  if (raw === null) {
    return createOpenCodeTabState();
  }

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return createOpenCodeTabState();
  }

  const decoded = decodeOpenCodePersistedState(value);
  if (Option.isNone(decoded)) {
    return createOpenCodeTabState();
  }
  const state = decoded.value;

  const tabs: OpenCodeTab[] = [];
  const keys = new Set<OpenCodeTabKey>();
  for (const candidate of state.tabs) {
    const tab = parseTab(candidate);
    if (tab === null) continue;
    const key = openCodeTabKey(tab);
    if (keys.has(key)) continue;
    keys.add(key);
    tabs.push(tab);
  }

  const sessionKeys = new Set(
    tabs.flatMap((tab) => {
      const owner = openCodeTabSessionRef(tab);
      return owner === null ? [] : [openCodeSessionTabKey(owner)];
    }),
  );
  const info: Record<string, OpenCodeTabInfo> = {};
  for (const [key, candidate] of Object.entries(state.info)) {
    if (!sessionKeys.has(key as OpenCodeTabKey)) continue;
    const parsed = parseInfo(candidate);
    if (parsed !== null) info[key] = parsed;
  }

  const closed = state.closed
    .flatMap((candidate): OpenCodeClosedTab[] => {
      const entry = decodeOpenCodePersistedClosed(candidate);
      if (Option.isNone(entry)) return [];
      const tab = parseTab(entry.value.tab);
      if (tab === null || tab.type === "draft") return [];
      return [
        Object.freeze({
          tab,
          index: Math.max(0, entry.value.index),
        }),
      ];
    })
    .slice(-OPEN_CODE_CLOSED_TAB_LIMIT);

  return freezeState({
    tabs,
    activeKey: parseSelectedKey(state.activeKey, keys),
    recentKey: parseSelectedKey(state.recentKey, keys),
    info,
    closed,
  });
}

function removeMatchingTabs(
  state: OpenCodeTabState,
  removeTab: (tab: OpenCodeTab) => boolean,
  removeClosed: (entry: OpenCodeClosedTab) => boolean,
): OpenCodeTabTransition {
  const removed = state.tabs.filter(removeTab);
  const nextClosed = state.closed.filter((entry) => !removeClosed(entry));
  if (removed.length === 0 && nextClosed.length === state.closed.length) {
    return unchanged(state);
  }

  const removedKeys = new Set(removed.map(openCodeTabKey));
  const tabs = state.tabs.filter((tab) => !removedKeys.has(openCodeTabKey(tab)));
  const activeKey =
    state.activeKey !== null && removedKeys.has(state.activeKey)
      ? neighborKeyForRemovedSelection(state.tabs, state.activeKey, removedKeys)
      : state.activeKey;
  const recentKey =
    state.recentKey !== null && removedKeys.has(state.recentKey)
      ? neighborKeyForRemovedSelection(state.tabs, state.recentKey, removedKeys)
      : state.recentKey;

  return transition(
    freezeState({
      ...state,
      tabs,
      activeKey,
      recentKey,
      info: pruneSessionInfo(state.info, tabs),
      closed: nextClosed,
    }),
    removed.flatMap((tab) => (tab.type === "draft" ? [tab.draftID] : [])),
  );
}

function neighborKeyForRemovedSelection(
  tabs: readonly OpenCodeTab[],
  selectedKey: OpenCodeTabKey,
  removedKeys: ReadonlySet<OpenCodeTabKey>,
): OpenCodeTabKey | null {
  const index = tabs.findIndex((tab) => openCodeTabKey(tab) === selectedKey);
  return neighborKeyAfterRemoval(tabs, index, removedKeys);
}

function neighborKeyAfterRemoval(
  tabs: readonly OpenCodeTab[],
  index: number,
  removedKeys: ReadonlySet<OpenCodeTabKey>,
): OpenCodeTabKey | null {
  for (let candidateIndex = index + 1; candidateIndex < tabs.length; candidateIndex += 1) {
    const candidate = tabs[candidateIndex];
    if (candidate === undefined) continue;
    const key = openCodeTabKey(candidate);
    if (!removedKeys.has(key)) return key;
  }
  for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
    const candidate = tabs[candidateIndex];
    if (candidate === undefined) continue;
    const key = openCodeTabKey(candidate);
    if (!removedKeys.has(key)) return key;
  }
  return null;
}

function parseTab(value: unknown): OpenCodeTab | null {
  const decoded = decodeOpenCodePersistedTab(value);
  if (Option.isNone(decoded)) {
    return null;
  }
  const raw = decoded.value;
  try {
    const server = openCodeServerKey(raw.server);
    if (raw.type === "session") {
      return openCodeSessionTab(openCodeSessionRef(server, raw.sessionID));
    }
    return openCodeDraftTab({
      draftID: raw.draftID,
      server,
      location: openCodeLocationRef({
        directory: raw.location.directory,
        ...(raw.location.workspaceID !== undefined
          ? { workspaceID: raw.location.workspaceID }
          : {}),
      }),
      target:
        raw.target === undefined
          ? OPEN_CODE_LOCAL_SESSION_TARGET
          : raw.target.type === "workspace"
            ? {
                type: "workspace",
                location: openCodeLocationRef({
                  directory: raw.target.location.directory,
                  ...(raw.target.location.workspaceID === undefined
                    ? {}
                    : { workspaceID: raw.target.location.workspaceID }),
                }),
              }
            : raw.target,
    });
  } catch {
    return null;
  }
}

function parseInfo(value: unknown): OpenCodeTabInfo | null {
  const decoded = decodeOpenCodePersistedInfo(value);
  if (Option.isNone(decoded)) return null;
  const raw = decoded.value;
  if (raw.title === undefined && raw.directory === undefined && raw.route === undefined)
    return null;
  return Object.freeze({
    ...(raw.title !== undefined ? { title: raw.title } : {}),
    ...(raw.directory !== undefined ? { directory: raw.directory } : {}),
    ...(raw.route !== undefined ? { route: raw.route } : {}),
  });
}

function parseSelectedKey(
  value: unknown,
  keys: ReadonlySet<OpenCodeTabKey>,
): OpenCodeTabKey | null {
  if (typeof value !== "string") return null;
  const key = value as OpenCodeTabKey;
  return keys.has(key) ? key : null;
}

function sessionInfo(session: Pick<OpenCodeSessionInfo, "title" | "location">): OpenCodeTabInfo {
  return Object.freeze({
    title: session.title,
    directory: session.location.directory,
  });
}

function withInfo(
  info: Readonly<Record<string, OpenCodeTabInfo>>,
  key: OpenCodeTabKey,
  value: OpenCodeTabInfo,
): Readonly<Record<string, OpenCodeTabInfo>> {
  return Object.freeze({ ...info, [key]: value });
}

function withoutInfo(
  info: Readonly<Record<string, OpenCodeTabInfo>>,
  removedKeys: ReadonlySet<OpenCodeTabKey>,
): Readonly<Record<string, OpenCodeTabInfo>> {
  if (![...removedKeys].some((key) => info[key] !== undefined)) {
    return info;
  }
  const next: Record<string, OpenCodeTabInfo> = {};
  for (const [key, value] of Object.entries(info)) {
    if (!removedKeys.has(key as OpenCodeTabKey)) next[key] = value;
  }
  return Object.freeze(next);
}

function pruneSessionInfo(
  info: Readonly<Record<string, OpenCodeTabInfo>>,
  tabs: readonly OpenCodeTab[],
): Readonly<Record<string, OpenCodeTabInfo>> {
  const retained = new Set(
    tabs.flatMap((tab) => {
      const owner = openCodeTabSessionRef(tab);
      return owner === null ? [] : [openCodeSessionTabKey(owner)];
    }),
  );
  const removed = new Set(
    Object.keys(info).filter((key) => !retained.has(key as OpenCodeTabKey)) as OpenCodeTabKey[],
  );
  return withoutInfo(info, removed);
}

function freezeState(state: Omit<OpenCodeTabState, "schema" | "version">): OpenCodeTabState {
  return Object.freeze({
    schema: OPEN_CODE_TAB_SCHEMA,
    version: OPEN_CODE_TAB_VERSION,
    tabs: Object.freeze([...state.tabs]),
    activeKey: state.activeKey,
    recentKey: state.recentKey,
    info: Object.freeze({ ...state.info }),
    closed: Object.freeze([...state.closed]),
  });
}

function transition(
  state: OpenCodeTabState,
  discardedDraftIDs: readonly string[],
): OpenCodeTabTransition {
  return Object.freeze({
    state,
    discardedDraftIDs: Object.freeze([...discardedDraftIDs]),
  });
}

function unchanged(state: OpenCodeTabState): OpenCodeTabTransition {
  return Object.freeze({ state, discardedDraftIDs: NO_DISCARDED_DRAFTS });
}

function requireIdentifier(value: string, label: string): string {
  const identifier = value.trim();
  if (identifier.length === 0) {
    throw new Error(`An OpenCode ${label} is required.`);
  }
  return identifier;
}

export {
  OPEN_CODE_CLOSED_TAB_LIMIT,
  OPEN_CODE_TAB_SCHEMA,
  OPEN_CODE_TAB_VERSION,
  addOpenCodeDraftTab,
  addOpenCodeSessionTab,
  closeOpenCodeTab,
  createOpenCodeTabState,
  hydrateOpenCodeTabState,
  openCodeDraftIDFromTabKey,
  openCodeDraftTabKey,
  openCodeSessionTabKey,
  openCodeTabSessionRef,
  openCodeTabKey,
  promoteOpenCodeDraft,
  rememberOpenCodeSessionInfo,
  rememberOpenCodeSessionRoute,
  removeOpenCodeServer,
  removeOpenCodeSessions,
  reorderOpenCodeTabs,
  reopenClosedOpenCodeTab,
  selectOpenCodeTab,
  serializeOpenCodeTabState,
  showOpenCodeHome,
  toggleOpenCodeHome,
  updateOpenCodeDraftTab,
};
export type {
  OpenCodeClosedTab,
  OpenCodeDraftInput,
  OpenCodeDraftTab,
  OpenCodeSessionTab,
  OpenCodeTab,
  OpenCodeTabInfo,
  OpenCodeTabKey,
  OpenCodeTabState,
  OpenCodeTabTransition,
};
