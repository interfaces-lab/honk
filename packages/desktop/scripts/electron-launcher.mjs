// This file patches Electron bundles so macOS uses the Honk app identity
// instead of the stock Electron identity.

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LAUNCHER_VERSION = 3;

const currentDir = dirname(fileURLToPath(import.meta.url));
export const desktopDir = resolve(currentDir, "..");
const productionLauncherIconPath = join(desktopDir, "resources", "icon.icns");

function resolveLauncherIdentity(isDevelopment) {
  return isDevelopment
    ? {
        appDisplayName: "Honk (Dev)",
        appBundleId: "com.interfacesco.honk.dev",
        iconPath: productionLauncherIconPath,
      }
    : {
        appDisplayName: "Honk",
        appBundleId: "com.interfacesco.honk",
        iconPath: productionLauncherIconPath,
      };
}

function setPlistString(plistPath, key, value) {
  const replaceResult = spawnSync("plutil", ["-replace", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (replaceResult.status === 0) {
    return;
  }

  const insertResult = spawnSync("plutil", ["-insert", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (insertResult.status === 0) {
    return;
  }

  const details = [replaceResult.stderr, insertResult.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to update plist key "${key}" at ${plistPath}: ${details}`.trim());
}

function patchMainBundleInfoPlist(appBundlePath, identity) {
  const infoPlistPath = join(appBundlePath, "Contents", "Info.plist");
  setPlistString(infoPlistPath, "CFBundleDisplayName", identity.appDisplayName);
  setPlistString(infoPlistPath, "CFBundleName", identity.appDisplayName);
  setPlistString(infoPlistPath, "CFBundleIdentifier", identity.appBundleId);
  setPlistString(infoPlistPath, "CFBundleIconFile", "icon.icns");

  const resourcesDir = join(appBundlePath, "Contents", "Resources");
  copyFileSync(identity.iconPath, join(resourcesDir, "icon.icns"));
  copyFileSync(identity.iconPath, join(resourcesDir, "electron.icns"));
}

function patchHelperBundleInfoPlists(appBundlePath, identity) {
  const frameworksDir = join(appBundlePath, "Contents", "Frameworks");
  if (!existsSync(frameworksDir)) {
    return;
  }

  for (const entry of readdirSync(frameworksDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith(".app")) {
      continue;
    }
    if (!entry.name.startsWith("Electron Helper")) {
      continue;
    }

    const helperPlistPath = join(frameworksDir, entry.name, "Contents", "Info.plist");
    if (!existsSync(helperPlistPath)) {
      continue;
    }

    const suffix = entry.name.replace("Electron Helper", "").replace(".app", "").trim();
    const helperName = suffix
      ? `${identity.appDisplayName} Helper ${suffix}`
      : `${identity.appDisplayName} Helper`;
    const helperIdSuffix = suffix.replace(/[()]/g, "").trim().toLowerCase().replace(/\s+/g, "-");
    const helperBundleId = helperIdSuffix
      ? `${identity.appBundleId}.helper.${helperIdSuffix}`
      : `${identity.appBundleId}.helper`;

    setPlistString(helperPlistPath, "CFBundleDisplayName", helperName);
    setPlistString(helperPlistPath, "CFBundleName", helperName);
    setPlistString(helperPlistPath, "CFBundleIdentifier", helperBundleId);
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function hasMacRuntimeResources(appBundlePath) {
  return existsSync(
    join(
      appBundlePath,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "A",
      "Resources",
      "icudtl.dat",
    ),
  );
}

function buildMacLauncher(electronBinaryPath, isDevelopment) {
  const identity = resolveLauncherIdentity(isDevelopment);
  const sourceAppBundlePath = resolve(electronBinaryPath, "../../..");
  const runtimeDir = join(desktopDir, ".electron-runtime");
  const targetAppBundlePath = join(runtimeDir, `${identity.appDisplayName}.app`);
  const targetBinaryPath = join(targetAppBundlePath, "Contents", "MacOS", "Electron");
  const metadataPath = join(runtimeDir, `${identity.appDisplayName}.metadata.json`);

  mkdirSync(runtimeDir, { recursive: true });

  const expectedMetadata = {
    launcherVersion: LAUNCHER_VERSION,
    appDisplayName: identity.appDisplayName,
    appBundleId: identity.appBundleId,
    sourceAppBundlePath,
    sourceAppMtimeMs: statSync(sourceAppBundlePath).mtimeMs,
    iconPath: identity.iconPath,
    iconMtimeMs: statSync(identity.iconPath).mtimeMs,
  };

  const currentMetadata = readJson(metadataPath);
  if (
    existsSync(targetBinaryPath) &&
    hasMacRuntimeResources(targetAppBundlePath) &&
    currentMetadata &&
    JSON.stringify(currentMetadata) === JSON.stringify(expectedMetadata)
  ) {
    return targetBinaryPath;
  }

  rmSync(targetAppBundlePath, { recursive: true, force: true });
  cpSync(sourceAppBundlePath, targetAppBundlePath, { recursive: true, verbatimSymlinks: true });
  patchMainBundleInfoPlist(targetAppBundlePath, identity);
  patchHelperBundleInfoPlists(targetAppBundlePath, identity);
  writeFileSync(metadataPath, `${JSON.stringify(expectedMetadata, null, 2)}\n`);

  return targetBinaryPath;
}

function installElectronBinary(require) {
  const electronPackagePath = require.resolve("electron/package.json");
  const electronPackageDir = dirname(electronPackagePath);
  const installScriptPath = join(electronPackageDir, "install.js");

  const result = spawnSync("node", [installScriptPath], {
    cwd: electronPackageDir,
    encoding: "utf8",
    env: process.env,
  });

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`Failed to install Electron binary: ${details}`.trim());
  }
}

export function resolveElectronPath({ isDevelopment = false } = {}) {
  const require = createRequire(import.meta.url);
  let electronBinaryPath;

  try {
    electronBinaryPath = require("electron");
  } catch {
    installElectronBinary(require);
    electronBinaryPath = require("electron");
  }

  if (process.platform !== "darwin") {
    return electronBinaryPath;
  }

  return buildMacLauncher(electronBinaryPath, isDevelopment);
}
