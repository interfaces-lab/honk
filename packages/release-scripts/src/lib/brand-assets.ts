export const BRAND_ASSET_PATHS = {
  productionMacIconPng: "packages/desktop/resources/icon.png",
  productionLinuxIconPng: "assets/prod/multi-production-linux-icon-1024.png",
  productionWebFaviconIco: "assets/prod/multi-black-web-favicon.ico",
  productionWebFavicon16Png: "assets/prod/multi-black-web-favicon-16x16.png",
  productionWebFavicon32Png: "assets/prod/multi-black-web-favicon-32x32.png",
  productionSplashIconPng: "assets/prod/multi-production-splash-icon-180.png",

  developmentMacIconIcns: "assets/dev/multi-development-macos-icon.icns",
  developmentDesktopIconPng: "assets/dev/multi-development-desktop-icon-1024.png",
  developmentWebFaviconIco: "assets/dev/blueprint-web-favicon.ico",
  developmentWebFavicon16Png: "assets/dev/blueprint-web-favicon-16x16.png",
  developmentWebFavicon32Png: "assets/dev/blueprint-web-favicon-32x32.png",
  developmentSplashIconPng: "assets/dev/multi-development-splash-icon-180.png",
} as const;

export interface IconOverride {
  readonly sourceRelativePath: string;
  readonly targetRelativePath: string;
}

export const DEVELOPMENT_ICON_OVERRIDES: ReadonlyArray<IconOverride> = [
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFaviconIco,
    targetRelativePath: "dist/client/favicon.ico",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
    targetRelativePath: "dist/client/favicon-16x16.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
    targetRelativePath: "dist/client/favicon-32x32.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentSplashIconPng,
    targetRelativePath: "dist/client/apple-touch-icon.png",
  },
];

export const PUBLISH_ICON_OVERRIDES: ReadonlyArray<IconOverride> = [
  {
    sourceRelativePath: BRAND_ASSET_PATHS.productionWebFaviconIco,
    targetRelativePath: "dist/client/favicon.ico",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon16Png,
    targetRelativePath: "dist/client/favicon-16x16.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon32Png,
    targetRelativePath: "dist/client/favicon-32x32.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.productionSplashIconPng,
    targetRelativePath: "dist/client/apple-touch-icon.png",
  },
];
