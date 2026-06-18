export type ThreadState = "running" | "done" | "needs_attention" | "draft";

export const demoProjectLabel = "honk";

export const marketingDemoThreadIds = [
  "marketing-homepage",
  "auth-redirect",
  "dark-mode-tokens",
  "release-notes",
  "refactor-tool-registry",
  "effect-streams",
] as const;

export type MarketingDemoThreadId = (typeof marketingDemoThreadIds)[number];

export type MarketingDemoThread = {
  id: MarketingDemoThreadId;
  title: string;
  ago: string;
};

export const marketingDemoThreads = [
  {
    id: "marketing-homepage",
    title: "Marketing homepage mock",
    ago: "now",
  },
  {
    id: "auth-redirect",
    title: "Fix auth redirect loop",
    ago: "2m",
  },
  {
    id: "dark-mode-tokens",
    title: "Add dark mode tokens",
    ago: "14m",
  },
  {
    id: "release-notes",
    title: "Ship release notes",
    ago: "1h",
  },
  {
    id: "refactor-tool-registry",
    title: "Lazy tool registry",
    ago: "3h",
  },
  {
    id: "effect-streams",
    title: "Effect stream pipeline",
    ago: "5h",
  },
] as const satisfies readonly MarketingDemoThread[];

export const marketingDemoThreadById = Object.fromEntries(
  marketingDemoThreads.map((thread) => [thread.id, thread]),
) as Record<MarketingDemoThreadId, MarketingDemoThread>;

export function marketingDemoThreadTitle(threadId: MarketingDemoThreadId): string {
  return marketingDemoThreadById[threadId].title;
}
