module.exports = function configureBabel(api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { "react-compiler": true }]],
    plugins: [
      [
        "react-native-worklets/plugin",
        {
          bundleMode: true,
          strictGlobal: true,
          importForwarding: {
            moduleNames: ["remend"],
          },
        },
      ],
    ],
  };
};
