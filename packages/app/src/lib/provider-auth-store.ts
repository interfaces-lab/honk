import { create } from "zustand";

type Req = {
  provider: string;
  mode: "api_key" | "oauth";
  oauthSupported: boolean;
  run: (key?: string) => Promise<void>;
  oauth?: () => Promise<void>;
};

type State = {
  req: Req | null;
  open: (req: Req) => void;
  close: () => void;
  submit: (key?: string) => Promise<void>;
  oauth: () => Promise<void>;
};

export const useProviderAuthStore = create<State>()((set, get) => ({
  req: null,
  open: (req) => {
    set({ req });
  },
  close: () => {
    set({ req: null });
  },
  submit: async (key) => {
    const req = get().req;
    set({ req: null });
    if (!req) return;
    await req.run(key);
  },
  oauth: async () => {
    const req = get().req;
    if (!req?.oauth) return;
    await req.oauth();
    set({ req: null });
  },
}));
