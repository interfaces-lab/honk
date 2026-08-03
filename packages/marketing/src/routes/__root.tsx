import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import { useEffect } from "react";

import appCss from "../index.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Honk | Claude and Codex in one workspace" },
      {
        name: "description",
        content: "Honk is a native macOS workspace for running Claude and Codex in parallel.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      ...(import.meta.env.DEV ? [{ rel: "stylesheet" as const, href: "/virtual:stylex.css" }] : []),
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", href: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { rel: "icon", href: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  component: RootDocument,
});

function RootDocument() {
  useEffect(() => {
    if (import.meta.env.DEV) {
      void import("react-grab");
    }
  }, []);

  // The marketing stylesheet fixes a light color scheme, so token-backed surfaces
  // render consistently without a theme boot script.
  return (
    <html lang="en">
      <head>
        <HeadContent />
        {import.meta.env.DEV ? <script type="module" src="/@id/virtual:stylex:runtime" /> : null}
      </head>
      <body>
        <Outlet />
        <Analytics mode={import.meta.env.DEV ? "development" : "production"} />
        <Scripts />
      </body>
    </html>
  );
}
