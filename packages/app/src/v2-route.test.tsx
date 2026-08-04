import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { V2Page } from "./v2";
import { V2LoadingPage } from "./v2-route";

function omitNonvisualLoadingState(markup: string): string {
  return markup.replace(' aria-busy="true"', "").replace(' readOnly=""', "");
}

describe("V2LoadingPage", () => {
  it("keeps the loaded page's initial pixels while the route chunk resolves", () => {
    const loading = omitNonvisualLoadingState(renderToStaticMarkup(<V2LoadingPage />));
    const loaded = renderToStaticMarkup(<V2Page />);

    expect(loading).toBe(loaded);
  });
});
