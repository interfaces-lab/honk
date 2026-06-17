export type ThreadState = "running" | "done" | "needs_attention" | "draft";

export const demoProjectLabel = "honk";

export const marketingDemoThread = {
  id: "marketing-homepage",
  title: "Marketing homepage mock",
  ago: "now",
  state: "running",
} as const;
