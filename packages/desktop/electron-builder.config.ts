import type { Configuration } from "electron-builder";

function resolvePublishConfig(): Configuration["publish"] {
  const rawRepo =
    process.env.HONK_DESKTOP_UPDATE_REPOSITORY?.trim() ||
    process.env.GITHUB_REPOSITORY?.trim() ||
    "";
  if (!rawRepo) {
    return undefined;
  }

  const [owner, repo, ...rest] = rawRepo.split("/");
  if (!owner || !repo || rest.length > 0) {
    return undefined;
  }

  return [
    {
      provider: "github",
      owner,
      repo,
      releaseType: "release",
    },
  ];
}

function resolveMacIdentity(): NonNullable<Configuration["mac"]>["identity"] {
  return process.env.HONK_DESKTOP_SKIP_MAC_SIGNING === "true" ? null : undefined;
}

export default {
  appId: "com.interfacesco.honk",
  productName: "Honk",
  artifactName: "Honk-${version}-${arch}.${ext}",
  directories: {
    buildResources: "resources",
    output: "dist",
  },
  files: ["out/**/*", "!out/**/*.map", "!out/server/client/**/*", "resources/**/*"],
  publish: resolvePublishConfig(),
  mac: {
    target: ["dmg", "zip"],
    icon: "icon.icns",
    category: "public.app-category.developer-tools",
    identity: resolveMacIdentity(),
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: true,
  },
  dmg: {
    sign: true,
  },
  linux: {
    target: ["AppImage"],
    executableName: "honk",
    icon: "icon.png",
    category: "Development",
    desktop: {
      entry: {
        StartupWMClass: "honk",
      },
    },
  },
} satisfies Configuration;
