import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function listSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(path));
    } else if (path.endsWith(".ts") || path.endsWith(".tsx")) {
      files.push(path);
    }
  }
  return files;
}

function filesMatching(directory: string, pattern: RegExp): string[] {
  return listSourceFiles(directory).filter((file) => pattern.test(readFileSync(file, "utf8")));
}

const appSrc = join(process.cwd(), "src");
const repoPackagesRoot = join(process.cwd(), "..");
const storeFiles = listSourceFiles(join(appSrc, "stores"));
const piSdkImportPattern = /from ["']@earendil-works\/pi-/;
const honkRuntimeBootstrapAllowlist = new Set([join(appSrc, "local-api.ts")]);
const runtimePackageName = ["@honk", "runtime"].join("/");

describe("app package boundary", () => {
  it("does not import runtime package", () => {
    expect(filesMatching(appSrc, new RegExp(`from ["']${runtimePackageName}`))).toEqual([]);
  });

  it("does not import Pi SDK packages", () => {
    expect(filesMatching(appSrc, /from ["']@earendil-works\/pi-/)).toEqual([]);
  });

  it("does not import server internals", () => {
    expect(filesMatching(appSrc, /from ["']@honk\/server/)).toEqual([]);
  });

  it("does not use Effect services in React stores", () => {
    const effectServiceImports = storeFiles.filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        /from ["']effect\/(Context|Layer)["']/.test(source) ||
        /\bEffect\.(gen|fn|runPromise)\b/.test(source)
      );
    });
    expect(effectServiceImports).toEqual([]);
  });

  it("does not read window.honkRuntime outside bootstrap", () => {
    const offenders = listSourceFiles(appSrc).filter((file) => {
      if (honkRuntimeBootstrapAllowlist.has(file)) {
        return false;
      }
      return /window\.honkRuntime/.test(readFileSync(file, "utf8"));
    });
    expect(offenders).toEqual([]);
  });

  it("does not use readNativeRuntimeApi or native-runtime-api", () => {
    const offenders = listSourceFiles(appSrc).filter((file) => {
      const source = readFileSync(file, "utf8");
      return /readNativeRuntimeApi|native-runtime-api/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("keeps Pi SDK imports out of non-runtime packages", () => {
    const packagesToScan = ["app", "desktop", "shared"];
    const offenders: string[] = [];
    for (const packageName of packagesToScan) {
      const packageSrc = join(repoPackagesRoot, packageName, "src");
      for (const file of listSourceFiles(packageSrc)) {
        if (piSdkImportPattern.test(readFileSync(file, "utf8"))) {
          offenders.push(relative(repoPackagesRoot, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
