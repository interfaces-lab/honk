import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RightWorkbenchLayout } from "./right-workbench-layout";

describe("RightWorkbenchLayout", () => {
  it("keeps secondary rail content mounted when the rail is collapsed", () => {
    const html = renderToStaticMarkup(
      <RightWorkbenchLayout
        workspaceKey='{"rpcEnvironmentId":"environment:primary","cwd":"/repo"}'
        tab="files"
        railOpen={false}
        rail={<div data-testid="file-tree">File tree</div>}
      >
        <div>Preview</div>
      </RightWorkbenchLayout>,
    );

    expect(html).toContain('data-state="collapsed"');
    expect(html).toContain("File tree");
    expect(html).toContain("Preview");
  });
});
