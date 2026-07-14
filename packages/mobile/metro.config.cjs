const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { getBundleModeMetroConfig } = require("react-native-worklets/bundleMode");

const config = getDefaultConfig(__dirname);
const workletsPackageRoot = path.dirname(require.resolve("react-native-worklets/package.json"));

config.watchFolders = [
  ...new Set([...config.watchFolders, path.join(workletsPackageRoot, ".worklets")]),
];

module.exports = getBundleModeMetroConfig(config);
