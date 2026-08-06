import path from "node:path";
import { fileURLToPath } from "node:url";

const marketingDir = path.dirname(fileURLToPath(import.meta.url));

export default {
  plugins: {
    "@stylexswc/postcss-plugin": {
      include: [
        "src/**/*.{js,jsx,ts,tsx}",
        "../ui/src/{assistant-message,badge,button,icon,matrix,menu,shell,status-dot,switch,tabs,text,tool-call,tooltip,user-message,work-group}.tsx",
        "../ui/src/{platform-tokens,tokens}.stylex.ts",
      ],
      useCSSLayers: true,
      rsOptions: {
        dev: process.env.NODE_ENV !== "production",
        unstable_moduleResolution: {
          type: "commonJS",
          rootDir: marketingDir,
        },
      },
    },
    "@tailwindcss/postcss": {},
  },
};
