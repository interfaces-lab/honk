import { describe, expect, it } from "vitest";

import { QUEUED_TASKS_METADATA_KEY, queuedTasksSubmission } from "./queued-tasks";

describe("queued tasks submission", () => {
  it("serializes every queued request, attachment, and selected id in order", () => {
    const submission = queuedTasksSubmission([
      {
        id: "queue-1",
        text: "Implement the surface",
        files: [{ path: "/repo/surface.png", mime: "image/png" }],
      },
      {
        id: "queue-2",
        text: "Verify the protocol",
        files: [
          { path: "/repo/protocol.md", mime: "text/markdown" },
          { path: "/repo/log.txt", mime: "text/plain" },
        ],
      },
    ]);

    expect(submission.metadata).toEqual({
      [QUEUED_TASKS_METADATA_KEY]: {
        version: 1,
        reason: "queue",
        queueItemIDs: ["queue-1", "queue-2"],
      },
    });
    expect(submission.text).toContain("Start the queued tasks.");
    expect(JSON.parse(submission.text.slice(submission.text.indexOf("[")).trim())).toEqual([
      {
        task: 1,
        request: "Implement the surface",
        attachments: ["/repo/surface.png"],
      },
      {
        task: 2,
        request: "Verify the protocol",
        attachments: ["/repo/protocol.md", "/repo/log.txt"],
      },
    ]);
  });
});
