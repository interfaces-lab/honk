import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThreadPageLoading } from "./page-layout";
import { loadThreadPage } from "./page-route";

describe("ThreadPageLoading", () => {
  it("keeps the thread page's permanent connecting frame", () => {
    const markup = renderToStaticMarkup(<ThreadPageLoading />);

    expect(markup).toBe(
      '<div class="x1iyjqo2 xs83m0k x1t1x2f9 x2lwn1j xh8yej3 x78zum5 x1q0g3np"><div class="x1iyjqo2 x2lwn1j x78zum5 xdt5ytf x6s0dn4 xl56j7k x9gr1te xx5fdij"><span role="status" aria-label="Connecting to thread" data-slot="spinner" class="x3nfvp2 x6s0dn4 xl56j7k x2lah0s"><span class="x9f619 x1lliihq x1ezmbya x1y0btm7 xdh2fpr x1aly0d8 x1y8tgv x4ha4u0 x1aerksh x1aquc0h x8cf9uu x1esw782 xa4qsjk x6ej76u xq3k0oi x1hox4sc"></span></span></div></div>',
    );
  });

  it("reuses one route import", async () => {
    const first = loadThreadPage();
    const second = loadThreadPage();

    expect(second).toBe(first);
    expect((await first).ThreadPage).toBeTypeOf("function");
  });
});
