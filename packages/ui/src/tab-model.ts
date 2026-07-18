import type { HonkStyle, StyleProp } from "./style";
import type { ReactElement } from "react";

interface HomeTabDescriptor {
  key: string;
  title: string;
  // Home stays fixed at index 0. Auto width, no close, never draggable.
  kind: "home";
  status: "idle" | "working" | "needs-you" | "done" | "failed" | "draft";
}

type ThreadRepository =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly label: string }
  | { readonly state: "unavailable" };

type ThreadServer = {
  readonly label: string;
  readonly kind: "local" | "remote" | "cloud";
};

interface ThreadTabDescriptor {
  key: string;
  title: string;
  kind: "thread";
  status: HomeTabDescriptor["status"];
  // Repository may still be resolving. Keep the loading state so the tab can show chrome instead of a blank slot.
  repository: ThreadRepository;
  // Full session location for the tab preview. Keep it optional while metadata is resolving.
  path?: string;
  // Server home directory. The preview abbreviates path with ~ when it is known.
  homePath?: string;
  // Optional server label disambiguates equal titles. The session key stays opaque here.
  server?: ThreadServer;
}

interface UtilityTabDescriptor {
  key: string;
  title: string;
  kind: "utility";
  utility: "browser" | "changes";
  status: "idle";
  repository: ThreadRepository;
  path?: string;
  server?: ThreadServer;
}

type TabDescriptor = HomeTabDescriptor | ThreadTabDescriptor | UtilityTabDescriptor;

interface TabStripProps {
  tabs: readonly TabDescriptor[];
  activeKey: string;
  // Function properties keep store actions lint-clean under typescript/unbound-method when destructured.
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onReorder: (from: number, to: number) => void;
  onNew: () => void;
  // Present enables double-click rename on thread tabs. The strip commits trimmed, changed titles only.
  onRename?: (key: string, title: string) => void;
  renderContextMenu?: (tab: TabDescriptor, children: ReactElement) => ReactElement;
  style?: StyleProp<HonkStyle>;
}

export type {
  HomeTabDescriptor,
  TabDescriptor,
  TabStripProps,
  ThreadRepository,
  ThreadServer,
  ThreadTabDescriptor,
  UtilityTabDescriptor,
};
