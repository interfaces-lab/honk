import { play } from "cuelume";

import { DEFAULT_ALERT_SOUND, type AlertSoundSelection } from "./alert-sound-model";

// Keep the original database name so existing custom completion sounds migrate in place.
const DATABASE_NAME = "honk:completion-sound";
const DATABASE_VERSION = 1;
const STORE_NAME = "sounds";
const CUSTOM_SOUND_KEY = "custom";

export type AlertSoundPlaybackResult = "custom" | "built-in" | "unavailable";

let audioContext: AudioContext | null = null;
let activeSources: AudioScheduledSourceNode[] = [];
let storageMutationQueue = Promise.resolve();

export function installAlertSoundPlayback(): () => void {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return () => {};

  const unlock = (): void => {
    void resumeAudioContext();
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, { capture: true, once: true });
  window.addEventListener("keydown", unlock, { capture: true, once: true });
  return () => {
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
}

export function saveCustomAlertSound(blob: Blob): Promise<void> {
  return enqueueStorageMutation(() =>
    openDatabase().then(
      (database) =>
        new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(STORE_NAME, "readwrite");
          transaction.objectStore(STORE_NAME).put(blob, CUSTOM_SOUND_KEY);
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => {
            database.close();
            reject(transaction.error ?? new Error("Could not save the sound."));
          };
          transaction.onabort = () => {
            database.close();
            reject(transaction.error ?? new Error("Could not save the sound."));
          };
        }),
    ),
  );
}

export function deleteCustomAlertSound(): Promise<void> {
  return enqueueStorageMutation(() =>
    openDatabase().then(
      (database) =>
        new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(STORE_NAME, "readwrite");
          transaction.objectStore(STORE_NAME).delete(CUSTOM_SOUND_KEY);
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => {
            database.close();
            reject(transaction.error ?? new Error("Could not reset the sound."));
          };
          transaction.onabort = () => {
            database.close();
            reject(transaction.error ?? new Error("Could not reset the sound."));
          };
        }),
    ),
  );
}

export function playAlertSound(
  selection: AlertSoundSelection,
  customFileName: string | null,
): Promise<AlertSoundPlaybackResult> {
  return playAlertSoundInternal(selection, customFileName).catch(() => "unavailable");
}

async function playAlertSoundInternal(
  selection: AlertSoundSelection,
  customFileName: string | null,
): Promise<AlertSoundPlaybackResult> {
  if (selection !== "custom") {
    stopActiveSources();
    play(selection);
    return "built-in";
  }

  if (customFileName === null) {
    stopActiveSources();
    play(DEFAULT_ALERT_SOUND);
    return "built-in";
  }

  const context = await resumeAudioContext();
  if (context === null) return "unavailable";

  stopActiveSources();
  const blob = await readCustomAlertSound().catch(() => null);
  if (blob !== null) {
    const bytes = await blob.arrayBuffer().catch(() => null);
    const buffer = bytes === null ? null : await context.decodeAudioData(bytes).catch(() => null);
    if (buffer !== null) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      activeSources = [source];
      source.addEventListener("ended", () => {
        if (activeSources[0] === source) activeSources = [];
      });
      source.start();
      return "custom";
    }
  }

  play(DEFAULT_ALERT_SOUND);
  return "built-in";
}

function enqueueStorageMutation(operation: () => Promise<void>): Promise<void> {
  const result = storageMutationQueue.then(operation);
  storageMutationQueue = result.catch(() => {});
  return result;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Sound storage is unavailable."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Sound storage is unavailable."));
    request.onblocked = () => reject(new Error("Sound storage is unavailable."));
  });
}

function readCustomAlertSound(): Promise<Blob | null> {
  return openDatabase().then(
    (database) =>
      new Promise<Blob | null>((resolve, reject) => {
        const request = database
          .transaction(STORE_NAME, "readonly")
          .objectStore(STORE_NAME)
          .get(CUSTOM_SOUND_KEY);
        request.onsuccess = () => {
          database.close();
          resolve(request.result instanceof Blob ? request.result : null);
        };
        request.onerror = () => {
          database.close();
          reject(request.error ?? new Error("Could not load the sound."));
        };
      }),
  );
}

function resumeAudioContext(): Promise<AudioContext | null> {
  if (typeof AudioContext === "undefined") return Promise.resolve(null);
  return Promise.resolve()
    .then(async () => {
      audioContext ??= new AudioContext();
      if (audioContext.state === "suspended") await audioContext.resume();
      return audioContext.state === "running" ? audioContext : null;
    })
    .catch(() => null);
}

function stopActiveSources(): void {
  activeSources.forEach((source) => {
    try {
      source.stop();
    } catch {
      // A source that has already ended is safe to ignore.
    }
  });
  activeSources = [];
}
