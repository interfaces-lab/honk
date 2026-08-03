import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AttachmentList } from "./attachments";

describe("composer attachment chips", () => {
  it.each([
    ["settings.json", "json"],
    ["Dockerfile", "docker"],
  ])("uses Pierre file identity for %s", (label, token) => {
    const html = renderToStaticMarkup(
      <AttachmentList
        attachments={[
          {
            key: label,
            label,
            path: `/repo/${label}`,
          },
        ]}
      />,
    );

    expect(html).toContain(label);
    expect(html).toContain(`data-icon-token="${token}"`);
    expect(html).toContain(`href="#file-tree-builtin-${token}"`);
  });
});
