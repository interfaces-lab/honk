import { create } from "zustand";

export type HeroFxShot = {
  id: string;
  text: string;
};

type State = {
  shot: HeroFxShot | null;
  fire: (text: string) => void;
  clear: (id?: string) => void;
};

export const useHeroFxStore = create<State>()((set) => ({
  shot: null,
  fire: (text) => {
    const next = text.trim().replace(/\s+/g, " ").slice(0, 140);
    if (!next) return;
    set({ shot: { id: crypto.randomUUID(), text: next } });
  },
  clear: (id) => {
    set((state) => {
      if (!state.shot) return state;
      if (id && state.shot.id !== id) return state;
      return { shot: null };
    });
  },
}));

export function fireHeroFx(text: string) {
  useHeroFxStore.getState().fire(text);
}
