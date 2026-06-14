import * as Schema from "effect/Schema";
import * as Record from "effect/Record";
import { useMemo, useRef, useSyncExternalStore } from "react";

const isomorphicLocalStorage: Storage =
  typeof window !== "undefined"
    ? window.localStorage
    : (function () {
        const store = new Map<string, string>();
        return {
          clear: () => store.clear(),
          getItem: (_) => store.get(_) ?? null,
          key: (_) => Record.keys(store).at(_) ?? null,
          get length() {
            return store.size;
          },
          removeItem: (_) => store.delete(_),
          setItem: (_, value) => store.set(_, value),
        };
      })();

const decode = <T, E>(schema: Schema.Codec<T, E>, value: string) =>
  Schema.decodeSync(Schema.fromJsonString(schema))(value);

const encode = <T, E>(schema: Schema.Codec<T, E>, value: T) =>
  Schema.encodeSync(Schema.fromJsonString(schema))(value);

export const getLocalStorageItem = <T, E>(key: string, schema: Schema.Codec<T, E>): T | null => {
  const item = isomorphicLocalStorage.getItem(key);
  return item ? decode(schema, item) : null;
};

export const setLocalStorageItem = <T, E>(key: string, value: T, schema: Schema.Codec<T, E>) => {
  const valueToSet = encode(schema, value);
  isomorphicLocalStorage.setItem(key, valueToSet);
};

export const removeLocalStorageItem = (key: string) => {
  isomorphicLocalStorage.removeItem(key);
};

const LOCAL_STORAGE_CHANGE_EVENT = "honk:local_storage_change";

interface LocalStorageChangeDetail {
  key: string;
  origin: string;
}

let localStorageOriginId = 0;

function nextLocalStorageOriginId(): string {
  localStorageOriginId += 1;
  return `origin:${localStorageOriginId}`;
}

function dispatchLocalStorageChange(key: string, origin: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<LocalStorageChangeDetail>(LOCAL_STORAGE_CHANGE_EVENT, {
      detail: { key, origin },
    }),
  );
}

function readLocalStorageValue<T, E>(key: string, schema: Schema.Codec<T, E>, initialValue: T): T {
  try {
    const item = getLocalStorageItem(key, schema);
    return item ?? initialValue;
  } catch (error) {
    console.error("[LOCALSTORAGE] Error:", error);
    return initialValue;
  }
}

interface LocalStorageStore<T> {
  readonly getSnapshot: () => T;
  readonly subscribe: (listener: () => void) => () => void;
  readonly setValue: (value: T | ((val: T) => T)) => void;
}

function createLocalStorageStore<T, E>(input: {
  key: string;
  schema: Schema.Codec<T, E>;
  origin: string;
  getInitialValue: () => T;
}): LocalStorageStore<T> {
  const listeners = new Set<() => void>();
  let cachedSnapshot: { raw: string | null; value: T } | null = null;

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const getSnapshot = () => {
    const raw = isomorphicLocalStorage.getItem(input.key);
    if (cachedSnapshot && cachedSnapshot.raw === raw) {
      return cachedSnapshot.value;
    }
    const value = readLocalStorageValue(input.key, input.schema, input.getInitialValue());
    cachedSnapshot = { raw, value };
    return value;
  };

  return {
    getSnapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      if (typeof window === "undefined") {
        return () => {
          listeners.delete(listener);
        };
      }

      const handleStorageChange = (event: StorageEvent) => {
        if (event.key !== input.key) {
          return;
        }
        cachedSnapshot = null;
        notify();
      };

      const handleLocalChange = (event: CustomEvent<LocalStorageChangeDetail>) => {
        if (event.detail.key !== input.key || event.detail.origin === input.origin) {
          return;
        }
        cachedSnapshot = null;
        notify();
      };

      window.addEventListener("storage", handleStorageChange);
      window.addEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleLocalChange as EventListener);

      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", handleStorageChange);
        window.removeEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleLocalChange as EventListener);
      };
    },
    setValue: (value) => {
      try {
        const previousValue = getSnapshot();
        const valueToStore =
          typeof value === "function" ? (value as (val: T) => T)(previousValue) : value;
        if (valueToStore === null) {
          removeLocalStorageItem(input.key);
        } else {
          setLocalStorageItem(input.key, valueToStore, input.schema);
        }
        cachedSnapshot = {
          raw: isomorphicLocalStorage.getItem(input.key),
          value: valueToStore,
        };
        notify();
        queueMicrotask(() => dispatchLocalStorageChange(input.key, input.origin));
      } catch (error) {
        console.error("[LOCALSTORAGE] Error:", error);
      }
    },
  };
}

export function useLocalStorage<T, E>(
  key: string,
  initialValue: T,
  schema: Schema.Codec<T, E>,
): [T, (value: T | ((val: T) => T)) => void] {
  const originRef = useRef(nextLocalStorageOriginId());
  const initialValueRef = useRef(initialValue);
  initialValueRef.current = initialValue;
  const store = useMemo(
    () =>
      createLocalStorageStore({
        key,
        schema,
        origin: originRef.current,
        getInitialValue: () => initialValueRef.current,
      }),
    [key, schema],
  );
  const storedValue = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => initialValueRef.current,
  );

  return [storedValue, store.setValue];
}
