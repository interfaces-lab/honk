import { create } from "zustand";

type State = {
  unread: Record<string, true>;
  mark: (id: string) => void;
  clear: (id: string) => void;
  isUnread: (id: string) => boolean;
};

export const useThreadUnreadStore = create<State>()((set, get) => ({
  unread: {},
  mark: (id) => {
    set((s) => (s.unread[id] ? s : { unread: { ...s.unread, [id]: true } }));
  },
  clear: (id) => {
    set((s) => {
      if (!s.unread[id]) return s;
      const { [id]: _, ...rest } = s.unread;
      return { unread: rest };
    });
  },
  isUnread: (id) => get().unread[id] === true,
}));
