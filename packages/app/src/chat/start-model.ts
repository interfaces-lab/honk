// Pure state machine for starting a chat: pick a workspace directory, meet
// the trust refusal, consent explicitly, choose a model, create. Mirrors
// spec/core.md: core refuses untrusted directories, so trust is a first-class
// UI step, never an implicit retry. Connection state is not here — the client
// store owns it.

import type { Workspace } from "@honk/core/workspace";

export type StartState =
  | { readonly step: "pick"; readonly error: string | null }
  | { readonly step: "opening"; readonly directory: string }
  | { readonly step: "trust"; readonly directory: string }
  | { readonly step: "trusting"; readonly directory: string }
  | {
      readonly step: "ready";
      readonly directory: string;
      readonly workspaceId: Workspace.WorkspaceId;
    }
  | { readonly step: "creating"; readonly directory: string };

export type StartEvent =
  | { readonly type: "directory_chosen"; readonly directory: string }
  | { readonly type: "open_result"; readonly result: Workspace.OpenResult }
  | { readonly type: "trust_accepted" }
  | { readonly type: "trust_declined" }
  | { readonly type: "trust_confirmed" }
  | { readonly type: "create_started" }
  | { readonly type: "workspace_closed" }
  | { readonly type: "request_failed"; readonly message: string };

export const initialState: StartState = { step: "pick", error: null };

// Total reducer: events that do not apply to the current step change nothing,
// so a stale async completion can never teleport the flow.
export const reduce = (state: StartState, event: StartEvent): StartState => {
  switch (event.type) {
    case "directory_chosen":
      return state.step === "pick" || state.step === "ready"
        ? { step: "opening", directory: event.directory }
        : state;
    case "open_result":
      if (state.step !== "opening") return state;
      return event.result.type === "trust_required"
        ? { step: "trust", directory: state.directory }
        : { step: "ready", directory: state.directory, workspaceId: event.result.id };
    case "trust_accepted":
      return state.step === "trust" ? { step: "trusting", directory: state.directory } : state;
    case "trust_declined":
      return state.step === "trust" ? { step: "pick", error: null } : state;
    case "trust_confirmed":
      return state.step === "trusting" ? { step: "opening", directory: state.directory } : state;
    case "create_started":
      return state.step === "ready" ? { step: "creating", directory: state.directory } : state;
    case "workspace_closed":
      return state.step === "ready" ? { step: "pick", error: null } : state;
    case "request_failed":
      return { step: "pick", error: event.message };
  }
};
