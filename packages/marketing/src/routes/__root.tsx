import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import { useEffect } from "react";

import { useMarketingResolvedTheme } from "../hooks/use-marketing-resolved-theme";
import appCss from "../index.css?url";

const MARKETING_THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,m=window.matchMedia("(prefers-color-scheme: dark)");d.classList.toggle("dark",m.matches);}catch(e){}})();`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Honk" },
      {
        name: "description",
        content: "Honk is an opinionated AI coding workspace for focused product work.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", href: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { rel: "icon", href: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  component: RootDocument,
});

function RootDocument() {
  const resolvedTheme = useMarketingResolvedTheme();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  }, [resolvedTheme]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      void import("react-grab");
    }
  }, []);

  return (
    <html
      lang="en"
      className="scroll-smooth bg-[#f7f8fb] font-sans text-neutral-950 antialiased dark:bg-neutral-950 dark:text-neutral-100"
      style={{ fontFeatureSettings: '"cv02", "cv03", "cv04", "cv11"' }}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: MARKETING_THEME_BOOT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="m-0 min-h-screen min-w-[320px] bg-[#f7f8fb] box-border dark:bg-neutral-950">
        <Outlet />
        <Analytics mode={import.meta.env.DEV ? "development" : "production"} />
        <Scripts />
      </body>
    </html>
  );
}
