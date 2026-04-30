import { create } from "zustand";

type State = {
  paths: string[];
  tick: number;
  mutes: Record<string, boolean>;
  note: (paths: string[]) => void;
  bump: () => void;
  clear: () => void;
  mute: (cwd: string) => void;
  unmute: (cwd: string) => void;
};

export const useShellLayoutStore = create<State>()((set) => ({
  paths: [],
  tick: 0,
  mutes: {},
  note: (paths) => {
    set({ paths: [...new Set(paths.filter(Boolean))] });
  },
  bump: () => {
    set((state) => ({ tick: state.tick + 1 }));
  },
  clear: () => {
    set({ paths: [] });
  },
  mute: (cwd) => {
    set((state) => (state.mutes[cwd] ? state : { mutes: { ...state.mutes, [cwd]: true } }));
  },
  unmute: (cwd) => {
    set((state) =>
      state.mutes[cwd] === false ? state : { mutes: { ...state.mutes, [cwd]: false } },
    );
  },
}));
