import { describe, expect, it, vi } from "vitest";

import { runMessageEdit } from "./message-edit";

describe("runMessageEdit", () => {
  it("reverts from the edited user message before resending", async () => {
    const order: string[] = [];
    const revert = vi.fn(async (messageID: string) => {
      order.push(`revert:${messageID}`);
    });

    await runMessageEdit({
      messageID: "msg_user_2",
      isRunning: true,
      interrupt: async () => {
        order.push("interrupt");
      },
      revert,
      restore: async () => {
        order.push("restore");
      },
      send: async () => {
        order.push("send");
      },
    });

    expect(revert).toHaveBeenCalledWith("msg_user_2");
    expect(order).toEqual(["interrupt", "revert:msg_user_2", "send"]);
  });

  it("restores the original turn when the replacement send fails", async () => {
    const revert = vi.fn(async () => undefined);
    const restore = vi.fn(async () => undefined);
    const failure = new Error("send failed");

    await expect(
      runMessageEdit({
        messageID: "msg_user_2",
        isRunning: false,
        interrupt: async () => undefined,
        revert,
        restore,
        send: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);

    expect(revert).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledOnce();
  });
});
