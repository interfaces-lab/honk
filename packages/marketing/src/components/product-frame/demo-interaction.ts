import type { MarketingTimelineItem } from "./demo-animation";

export type MarketingDemoBeat = { delayMs: number; item: MarketingTimelineItem };

type MarketingDemoReply = {
  chip?: string;
  match: RegExp;
  beats: readonly MarketingDemoBeat[];
};

const RETRY_TEST_PATCH = [
  "--- packages/core/src/retry.test.ts",
  "+++ packages/core/src/retry.test.ts",
  "@@ -12,4 +12,6 @@",
  '-    await vi.advanceTimersByTimeAsync(50);',
  '-    expect(attempts).toBe(3);',
  '+    await vi.advanceTimersByTimeAsync(backoffMs(3));',
  '+    await vi.runAllTicks();',
  '+    expect(attempts).toBeGreaterThanOrEqual(3);',
  '+    expect(lastError).toBeUndefined();',
].join("\n");

const SHORTCUT_PATCH = [
  "--- packages/app/src/keymap.ts",
  "+++ packages/app/src/keymap.ts",
  "@@ -31,2 +31,8 @@",
  '   { combo: "mod+w", command: "thread.close" },',
  '+  { combo: "mod+t", command: "thread.new" },',
  '+  { combo: "mod+shift+t", command: "thread.reopen" },',
].join("\n");

const flakyTestReply: MarketingDemoReply = {
  chip: "Fix the flaky retry test",
  match: /test|flaky|ci|spec/i,
  beats: [
    {
      delayMs: 600,
      item: {
        kind: "assistant",
        text: "That retry spec races the mock clock. I'll pin the timer math to the backoff schedule and rerun it.",
      },
    },
    {
      delayMs: 800,
      item: {
        kind: "tool",
        callId: "demo-grep-retry",
        loading: true,
        toolCall: {
          tool: { case: "grepToolCall", value: { action: "Grep", details: "advanceTimersByTimeAsync" } },
        },
      },
    },
    {
      delayMs: 1100,
      item: {
        kind: "tool",
        callId: "demo-grep-retry",
        loading: false,
        toolCall: {
          tool: {
            case: "grepToolCall",
            value: {
              action: "Grepped",
              details: "advanceTimersByTimeAsync",
              output: [
                "packages/core/src/retry.test.ts",
                " 14: await vi.advanceTimersByTimeAsync(50);",
              ].join("\n"),
            },
          },
        },
      },
    },
    {
      delayMs: 900,
      item: {
        kind: "tool",
        callId: "demo-edit-retry",
        loading: true,
        toolCall: {
          tool: {
            case: "editToolCall",
            value: { action: "Edit", details: "retry.test.ts", path: "packages/core/src/retry.test.ts" },
          },
        },
      },
    },
    {
      delayMs: 1400,
      item: {
        kind: "tool",
        callId: "demo-edit-retry",
        loading: false,
        preview: RETRY_TEST_PATCH,
        toolCall: {
          tool: {
            case: "editToolCall",
            value: {
              action: "Edit",
              details: "retry.test.ts",
              path: "packages/core/src/retry.test.ts",
              stats: { additions: 4, deletions: 2 },
            },
          },
        },
      },
    },
    {
      delayMs: 900,
      item: {
        kind: "assistant",
        text: "Pinned the clock to the backoff schedule and widened the flush assertion. 50 consecutive green runs locally.",
      },
    },
  ],
};

const shortcutReply: MarketingDemoReply = {
  chip: "Add ⌘T for new threads",
  match: /shortcut|keybind|key|⌘|cmd|hotkey/i,
  beats: [
    {
      delayMs: 600,
      item: {
        kind: "assistant",
        text: "The tab strip already exposes thread.new, so this is a keymap entry plus a reopen combo for symmetry with browsers.",
      },
    },
    {
      delayMs: 800,
      item: {
        kind: "tool",
        callId: "demo-edit-keymap",
        loading: true,
        toolCall: {
          tool: { case: "editToolCall", value: { action: "Edit", details: "keymap.ts", path: "packages/app/src/keymap.ts" } },
        },
      },
    },
    {
      delayMs: 1300,
      item: {
        kind: "tool",
        callId: "demo-edit-keymap",
        loading: false,
        preview: SHORTCUT_PATCH,
        toolCall: {
          tool: {
            case: "editToolCall",
            value: {
              action: "Edit",
              details: "keymap.ts",
              path: "packages/app/src/keymap.ts",
              stats: { additions: 2, deletions: 0 },
            },
          },
        },
      },
    },
    {
      delayMs: 800,
      item: {
        kind: "assistant",
        text: "Done. ⌘T opens a thread, ⇧⌘T reopens the last closed one.",
      },
    },
  ],
};

const explainReply: MarketingDemoReply = {
  chip: "What did the auth fix change?",
  match: /auth|explain|what|why|how/i,
  beats: [
    {
      delayMs: 700,
      item: {
        kind: "assistant",
        text: "The callback URL in session middleware still pointed at staging, so production logins bounced back to the consent screen forever. The fix reads the callback from the environment's own config and adds a regression test that fails if any OAuth env var references staging again.",
      },
    },
  ],
};

const fallbackReply: MarketingDemoReply = {
  match: /.*/,
  beats: [
    {
      delayMs: 600,
      item: {
        kind: "assistant",
        text: "This demo is canned, so I can't take that one on. In the app, a frontier agent with full project access picks it up. Download Honk below and try the same prompt for real.",
      },
    },
  ],
};

const marketingDemoReplies = [flakyTestReply, shortcutReply, explainReply, fallbackReply] as const;

export const marketingDemoChips = marketingDemoReplies
  .map((reply) => reply.chip)
  .filter((chip): chip is string => chip !== undefined);

export function resolveMarketingReply(text: string): readonly MarketingDemoBeat[] {
  const reply = marketingDemoReplies.find((candidate) => candidate.match.test(text)) ?? fallbackReply;
  return reply.beats;
}
