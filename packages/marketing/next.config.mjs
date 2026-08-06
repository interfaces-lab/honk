import path from "node:path";
import { fileURLToPath } from "node:url";

const marketingDir = path.dirname(fileURLToPath(import.meta.url));
const latestReleaseDownloadBase = "https://github.com/interfaces-lab/honk/releases/latest/download";
const stylexLoader = {
  loader: "@stylexswc/turbopack-plugin/loader",
  options: {
    extractCSS: false,
    nextjsMode: true,
    useCSSLayers: true,
    rsOptions: {
      dev: process.env.NODE_ENV !== "production",
      unstable_moduleResolution: {
        type: "commonJS",
        rootDir: marketingDir,
      },
    },
  },
};

export default {
  agentRules: false,
  transpilePackages: ["@honk/ui"],
  experimental: {
    turbopackPluginRuntimeStrategy: "workerThreads",
  },
  turbopack: {
    rules: {
      "*.ts": { loaders: [stylexLoader] },
      "*.tsx": { loaders: [stylexLoader] },
    },
  },
  async redirects() {
    return [
      {
        source: "/download/mac/arm64",
        destination: `${latestReleaseDownloadBase}/Honk-arm64.dmg`,
        permanent: false,
      },
      {
        source: "/download/mac/x64",
        destination: `${latestReleaseDownloadBase}/Honk-x64.dmg`,
        permanent: false,
      },
    ];
  },
};
