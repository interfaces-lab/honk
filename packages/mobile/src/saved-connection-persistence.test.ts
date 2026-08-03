import { describe, expect, it } from "vitest";

import {
  persistSavedConnectionCandidate,
  resolveSavedConnectionTransaction,
  type SavedConnectionTransaction,
} from "./saved-connection-persistence";

const markerOperations = {
  writeTransaction: async () => undefined,
  clearTransaction: async () => undefined,
};

describe("saved connection persistence", () => {
  it("restores an overwritten password when registry persistence fails", async () => {
    const events: string[] = [];
    const current = new Map([["studio", { label: "Old studio" }]]);
    let registryWrites = 0;
    await expect(
      persistSavedConnectionCandidate(
        current,
        "studio",
        "studio",
        { label: "Studio" },
        "old-password",
        "new-password",
        {
          ...markerOperations,
          writeCredential: async (password) => {
            events.push(`password:${password}`);
          },
          deleteCredential: async () => {
            events.push("delete");
          },
          writeRegistry: async () => {
            registryWrites += 1;
            events.push("registry");
            if (registryWrites === 1) throw new Error("storage unavailable");
          },
        },
      ),
    ).rejects.toThrow("storage unavailable");

    expect(events).toEqual([
      "password:new-password",
      "registry",
      "password:old-password",
      "registry",
    ]);
    expect(current.get("studio")?.label).toBe("Old studio");
  });

  it("deletes a newly written password when registry persistence fails", async () => {
    const events: string[] = [];
    let registryWrites = 0;
    await expect(
      persistSavedConnectionCandidate(new Map(), null, "studio", { label: "Studio" }, null, "new", {
        ...markerOperations,
        writeCredential: async () => {
          events.push("password");
        },
        deleteCredential: async () => {
          events.push("delete");
        },
        writeRegistry: async () => {
          registryWrites += 1;
          events.push("registry");
          if (registryWrites === 1) throw new Error("storage unavailable");
        },
      }),
    ).rejects.toThrow("storage unavailable");

    expect(events).toEqual(["password", "registry", "delete", "registry"]);
  });

  it("restores the previous durable snapshot after candidate health fails", async () => {
    const events: string[] = [];
    const current = new Map([["studio", { label: "Old studio" }]]);
    const persistence = await persistSavedConnectionCandidate(
      current,
      "studio",
      "studio",
      { label: "New studio" },
      "old-password",
      "bad-password",
      {
        ...markerOperations,
        writeCredential: async (password) => {
          events.push(`password:${password}`);
        },
        deleteCredential: async () => {
          events.push("delete");
        },
        writeRegistry: async (servers) => {
          events.push(`registry:${servers.get("studio")?.label ?? "empty"}`);
        },
      },
    );

    await persistence.restore();
    expect(events).toEqual([
      "password:bad-password",
      "registry:New studio",
      "password:old-password",
      "registry:Old studio",
    ]);
  });

  it("recovers a manual-password transaction after stopping between each storage write", async () => {
    for (const replacement of [false, true]) {
      for (const stopAfter of [1, 2, 3, 4]) {
        const state = savedConnectionStorage(replacement);
        const control = savedConnectionOperations(state);
        control.stopAfter(stopAfter);
        await persistSavedConnectionCandidate(
          state.servers,
          state.activeServerKey,
          "studio",
          { label: "New studio" },
          state.credential,
          "new-password",
          control.operations,
        ).catch(() => undefined);

        control.resume();
        await resolveTransaction(state, control.operations);
        expectSavedConnectionState(state, stopAfter >= 3 ? "candidate" : "previous", replacement);
      }

      for (const stopAfter of [1, 2, 3, 4]) {
        const state = savedConnectionStorage(replacement);
        const control = savedConnectionOperations(state);
        const persistence = await persistSavedConnectionCandidate(
          state.servers,
          state.activeServerKey,
          "studio",
          { label: "New studio" },
          state.credential,
          "new-password",
          control.operations,
        );
        control.stopAfter(stopAfter);
        await persistence.restore().catch(() => undefined);

        control.resume();
        await resolveTransaction(state, control.operations);
        expectSavedConnectionState(state, "previous", replacement);
      }
    }
  });
});

interface SavedConnectionStorage {
  servers: ReadonlyMap<string, { readonly label: string }>;
  activeServerKey: string | null;
  credential: string | null;
  transaction: SavedConnectionTransaction<string, { readonly label: string }> | null;
}

function savedConnectionStorage(replacement: boolean): SavedConnectionStorage {
  return {
    servers: replacement ? new Map([["studio", { label: "Old studio" }]]) : new Map(),
    activeServerKey: replacement ? "studio" : null,
    credential: replacement ? "old-password" : null,
    transaction: null,
  };
}

function savedConnectionOperations(state: SavedConnectionStorage) {
  let stopAt: number | null = null;
  let writes = 0;
  let stopped = false;
  const write = (update: () => void): void => {
    if (stopped) throw new Error("app stopped");
    update();
    writes += 1;
    if (writes !== stopAt) return;
    stopped = true;
    throw new Error("app stopped");
  };
  return {
    operations: {
      writeCredential: async (credential: string) => {
        write(() => {
          state.credential = credential;
        });
      },
      deleteCredential: async () => {
        write(() => {
          state.credential = null;
        });
      },
      writeRegistry: async (
        servers: ReadonlyMap<string, { readonly label: string }>,
        activeServerKey: string | null,
      ) => {
        write(() => {
          state.servers = new Map(servers);
          state.activeServerKey = activeServerKey;
        });
      },
      writeTransaction: async (
        transaction: SavedConnectionTransaction<string, { readonly label: string }>,
      ) => {
        write(() => {
          state.transaction = {
            ...transaction,
            previous: { ...transaction.previous, servers: new Map(transaction.previous.servers) },
            candidate: {
              ...transaction.candidate,
              servers: new Map(transaction.candidate.servers),
            },
          };
        });
      },
      clearTransaction: async () => {
        write(() => {
          state.transaction = null;
        });
      },
      isSameRegistry: (
        leftServers: ReadonlyMap<string, { readonly label: string }>,
        leftActiveServerKey: string | null,
        rightServers: ReadonlyMap<string, { readonly label: string }>,
        rightActiveServerKey: string | null,
      ) =>
        leftActiveServerKey === rightActiveServerKey &&
        leftServers.size === rightServers.size &&
        [...leftServers].every(([key, server]) => rightServers.get(key)?.label === server.label),
    },
    stopAfter: (next: number) => {
      stopAt = next;
      writes = 0;
      stopped = false;
    },
    resume: () => {
      stopAt = null;
      writes = 0;
      stopped = false;
    },
  };
}

async function resolveTransaction(
  state: SavedConnectionStorage,
  operations: ReturnType<typeof savedConnectionOperations>["operations"],
): Promise<void> {
  if (state.transaction === null) return;
  await resolveSavedConnectionTransaction(
    state.transaction,
    state.servers,
    state.activeServerKey,
    operations,
  );
}

function expectSavedConnectionState(
  state: SavedConnectionStorage,
  expected: "candidate" | "previous",
  replacement: boolean,
): void {
  expect(state.transaction).toBeNull();
  if (expected === "candidate") {
    expect([...state.servers]).toEqual([["studio", { label: "New studio" }]]);
    expect(state.activeServerKey).toBe("studio");
    expect(state.credential).toBe("new-password");
    return;
  }
  expect([...state.servers]).toEqual(replacement ? [["studio", { label: "Old studio" }]] : []);
  expect(state.activeServerKey).toBe(replacement ? "studio" : null);
  expect(state.credential).toBe(replacement ? "old-password" : null);
}
