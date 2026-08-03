import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..");
const electronBin = resolve(desktopDir, "node_modules/.bin/electron");
const mainJs = resolve(desktopDir, "out/main/index.js");
try {
  await readFile(mainJs, "utf8");
} catch (error) {
  console.error(`\nDesktop smoke test failed: could not read ${mainJs}.`);
  console.error(error);
  process.exit(1);
}

console.log("\nLaunching Electron smoke test...");

const child = spawn(electronBin, [mainJs], {
  detached: process.platform !== "win32",
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: "",
    ELECTRON_ENABLE_LOGGING: "1",
  },
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

const timeout = setTimeout(() => {
  if (process.platform === "win32" || child.pid === undefined) {
    child.kill("SIGKILL");
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}, 8_000);

child.on("exit", () => {
  clearTimeout(timeout);

  const fatalPatterns = [
    "Cannot find module",
    "MODULE_NOT_FOUND",
    "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING",
    "Refused to execute",
    "Uncaught Exception",
    "Uncaught Error",
    "Uncaught TypeError",
    "Uncaught ReferenceError",
  ];
  const failures = fatalPatterns.filter((pattern) => output.includes(pattern));

  if (failures.length > 0) {
    console.error("\nDesktop smoke test failed:");
    for (const failure of failures) {
      console.error(` - ${failure}`);
    }
    console.error("\nFull output:\n" + output);
    process.exit(1);
  }

  console.log("Desktop smoke test passed.");
  process.exit(0);
});
