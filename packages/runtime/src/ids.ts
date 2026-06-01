import {
  EventId,
  RuntimeItemId,
  RuntimeSessionId,
  ThreadEntryId,
  TurnId,
  type ThreadId,
} from "@multi/contracts";

export function makeRuntimeSessionId(value: string): RuntimeSessionId {
  return RuntimeSessionId.make(value);
}

export function makeRuntimeItemId(value: string): RuntimeItemId {
  return RuntimeItemId.make(value);
}

export function makeThreadEntryIdForRuntimeEntry(value: string): ThreadEntryId {
  return ThreadEntryId.make(`runtime:${value}`);
}

export function makeRuntimeEventId(sequence: number): EventId {
  return EventId.make(`runtime:${sequence}`);
}

export function makeTurnId(threadId: ThreadId, sequence: number): TurnId {
  return TurnId.make(`${threadId}:turn:${sequence}`);
}
