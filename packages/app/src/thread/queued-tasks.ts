import type { QueueItem } from "../composer/queue-store";

const QUEUED_TASKS_METADATA_KEY = "honkQueuedTasks";

function queuedTasksSubmission(items: readonly QueueItem[]): {
  readonly text: string;
  readonly metadata: Readonly<Record<string, unknown>>;
} {
  return {
    text: [
      "Start the queued tasks.",
      "",
      "Treat every queued entry below as an independent user task. Initialize the TodoWrite list with one item per entry in this order, keep unrelated requests separate, and do not omit attachments.",
      "",
      JSON.stringify(
        items.map((item, index) => ({
          task: index + 1,
          request: item.text,
          attachments: item.files.map((file) => file.path),
        })),
        null,
        2,
      ),
    ].join("\n"),
    metadata: {
      [QUEUED_TASKS_METADATA_KEY]: {
        version: 1,
        reason: "queue",
        queueItemIDs: items.map((item) => item.id),
      },
    },
  };
}

export { QUEUED_TASKS_METADATA_KEY, queuedTasksSubmission };
