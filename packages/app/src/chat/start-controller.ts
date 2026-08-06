// Thin runtime glue for the start page: workspace open/trust calls, the model
// catalog, session creation, and a small recent-directories memory. All step
// transitions live in start-model.ts where they are tested.

import * as React from "react";

import type { Models } from "@honk/core/models";

import { canPickFolder, pickFolder } from "../desktop-bridge";
import { describeError, getHonkClient } from "./client";
import type { ModelChoice } from "./chat-controller";
import { createCoreSession } from "./chat-controller";
import type { StartEvent, StartState } from "./start-model";
import { initialState, reduce } from "./start-model";

const RECENT_KEY = "honk.chat.recent-directories";
const RECENT_LIMIT = 8;

type ProviderCatalogEntry = Models.ProviderSummary;

const readRecent = (): readonly string[] => {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const rememberRecent = (directory: string): readonly string[] => {
  const next = [directory, ...readRecent().filter((item) => item !== directory)].slice(
    0,
    RECENT_LIMIT,
  );
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Recents are a convenience; losing them is fine.
  }
  return next;
};

export interface ModelOption extends ModelChoice {
  readonly label: string;
}

/** An unconfigured provider and how a user could unlock it. */
export interface ProviderSetup {
  readonly id: string;
  readonly name: string;
  readonly methods: readonly ("api_key" | "oauth")[];
}

export interface ChatStart {
  readonly state: StartState;
  readonly recentDirectories: readonly string[];
  readonly canBrowse: boolean;
  /** Configured providers' models; empty until the catalog loads. */
  readonly modelOptions: readonly ModelOption[];
  /** Providers a user could still unlock, with the entry method each needs. */
  readonly providerSetups: readonly ProviderSetup[];
  readonly model: ModelChoice | null;
  readonly setModel: (choice: ModelChoice | null) => void;
  readonly openDirectory: (directory: string) => void;
  readonly browseForDirectory: () => void;
  readonly acceptTrust: () => void;
  readonly declineTrust: () => void;
  readonly closeWorkspace: () => void;
  /** Stores an API key and refreshes the catalog; rejects with a message. */
  readonly addKey: (providerId: string, key: string) => Promise<void>;
  /** Creates the session on the chosen model; resolves with its id. */
  readonly startChat: () => void;
}

export function useChatStart(input: {
  readonly onStarted: (sessionId: string) => void;
}): ChatStart {
  const [state, dispatch] = React.useReducer(reduce, initialState);
  const [recentDirectories, setRecentDirectories] = React.useState<readonly string[]>(readRecent);
  const [modelOptions, setModelOptions] = React.useState<readonly ModelOption[]>([]);
  const [providerSetups, setProviderSetups] = React.useState<readonly ProviderSetup[]>([]);
  const [model, setModel] = React.useState<ModelChoice | null>(null);
  const onStartedRef = React.useRef(input.onStarted);
  onStartedRef.current = input.onStarted;

  const openingDirectory = state.step === "opening" ? state.directory : null;
  const ready = state.step === "ready";

  const applyCatalog = (providers: readonly ProviderCatalogEntry[]): void => {
    setModelOptions(
      providers
        .filter((provider) => provider.configured)
        .flatMap((provider) =>
          provider.models.map((entry) => ({
            providerId: provider.id,
            modelId: entry.id,
            label: `${provider.id} / ${entry.name}`,
          })),
        ),
    );
    setProviderSetups(
      providers
        .filter((provider) => !provider.configured && provider.methods.length > 0)
        .map((provider) => ({
          id: provider.id,
          name: provider.name,
          methods: provider.methods,
        })),
    );
  };

  // Entering the opening step is the only trigger for the open call, whether
  // the step came from a picked directory or a completed trust. One cause,
  // one effect, no chained promises.
  React.useEffect(() => {
    if (openingDirectory === null) return;
    const sdk = getHonkClient();
    if (sdk === null) return;
    let stale = false;
    const emit = (event: StartEvent) => {
      if (!stale) dispatch(event);
    };
    sdk.workspace.open({ directory: openingDirectory }).then(
      (result) => {
        emit({ type: "open_result", result });
      },
      (error: unknown) => {
        emit({ type: "request_failed", message: describeError(error) });
      },
    );
    return () => {
      stale = true;
    };
  }, [openingDirectory]);

  // The model catalog loads once a workspace is ready — the moment the choice
  // becomes actionable. Configured providers feed the picker; unconfigured
  // ones with a login method feed the setup affordance.
  React.useEffect(() => {
    if (!ready) return;
    const sdk = getHonkClient();
    if (sdk === null) return;
    let stale = false;
    sdk.models.list({}).then(
      ({ providers }) => {
        if (!stale) applyCatalog(providers);
      },
      () => {
        // The picker is an enhancement; creation still works on the default.
      },
    );
    return () => {
      stale = true;
    };
  }, [ready, applyCatalog]);

  const openDirectory = (directory: string) => {
    dispatch({ type: "directory_chosen", directory });
    setRecentDirectories(rememberRecent(directory));
  };

  return {
    state,
    recentDirectories,
    canBrowse: canPickFolder(),
    modelOptions,
    providerSetups,
    model,
    setModel,
    addKey: async (providerId, key) => {
      const sdk = getHonkClient();
      if (sdk === null) throw new Error("Honk Core is not connected yet.");
      try {
        await sdk.models.setCredential({ providerId, key });
        const { providers } = await sdk.models.list({});
        applyCatalog(providers);
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
    openDirectory,
    browseForDirectory: () => {
      void pickFolder().then((directory) => {
        if (directory !== null) openDirectory(directory);
      });
    },
    acceptTrust: () => {
      if (state.step !== "trust") return;
      const { directory } = state;
      const sdk = getHonkClient();
      if (sdk === null) return;
      dispatch({ type: "trust_accepted" });
      sdk.workspace.trust({ directory }).then(
        () => {
          dispatch({ type: "trust_confirmed" });
        },
        (error: unknown) => {
          dispatch({ type: "request_failed", message: describeError(error) });
        },
      );
    },
    declineTrust: () => {
      dispatch({ type: "trust_declined" });
    },
    closeWorkspace: () => {
      dispatch({ type: "workspace_closed" });
    },
    startChat: () => {
      if (state.step !== "ready") return;
      const { workspaceId } = state;
      dispatch({ type: "create_started" });
      createCoreSession({ workspaceId, model }).then(
        (sessionId) => {
          onStartedRef.current(sessionId);
        },
        (error: unknown) => {
          dispatch({ type: "request_failed", message: describeError(error) });
        },
      );
    },
  };
}
