import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/react";

import "../index.css";

const geistSans = localFont({
  src: "../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2",
  variable: "--font-geist-sans-family",
  weight: "100 900",
});

const geistMono = localFont({
  src: "../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  variable: "--font-geist-mono-family",
  weight: "100 900",
});

const newsreader = localFont({
  src: [
    {
      path: "../../node_modules/@fontsource-variable/newsreader/files/newsreader-latin-opsz-normal.woff2",
      style: "normal",
      weight: "200 800",
    },
    {
      path: "../../node_modules/@fontsource-variable/newsreader/files/newsreader-latin-opsz-italic.woff2",
      style: "italic",
      weight: "200 800",
    },
  ],
  variable: "--font-newsreader-family",
});

export const metadata: Metadata = {
  title: "Honk | Claude and Codex in one workspace",
  description: "Honk is a native macOS workspace for running Claude and Codex in parallel.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const fontVariables = `${geistSans.variable} ${geistMono.variable} ${newsreader.variable}`;

  return (
    <html className={fontVariables} lang="en">
      <body>
        <div id="marketing-root">{children}</div>
        <Analytics />
      </body>
    </html>
  );
}
