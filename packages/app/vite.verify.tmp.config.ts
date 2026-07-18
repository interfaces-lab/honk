// Temporary verification config. Same-origin proxy to an isolated sidecar. Delete after use.
import { defineConfig, mergeConfig } from "vite";

import base from "./vite.config";

const SIDECAR = "http://127.0.0.1:14096";
const API_PREFIXES = [
  "agent",
  "api",
  "auth",
  "command",
  "config",
  "event",
  "experimental",
  "file",
  "find",
  "formatter",
  "global",
  "instance",
  "log",
  "lsp",
  "mcp",
  "path",
  "permission",
  "project",
  "provider",
  "pty",
  "question",
  "session",
  "skill",
  "sync",
  "tui",
  "vcs",
];

export default mergeConfig(
  base,
  defineConfig({
    server: {
      port: 5273,
      strictPort: true,
      proxy: Object.fromEntries(
        API_PREFIXES.map((prefix) => [
          `/${prefix}`,
          { target: SIDECAR, changeOrigin: true, ws: true },
        ]),
      ),
    },
  }),
);
