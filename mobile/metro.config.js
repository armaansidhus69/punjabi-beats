/**
 * Metro config — Expo SDK 51 + RN 0.74.
 * react-native-qrcode-svg documents this TextEncoder transformer for RN <0.75.
 */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.transformer = {
  ...config.transformer,
  babelTransformerPath: require.resolve(
    'react-native-qrcode-svg/textEncodingTransformation',
  ),
};

module.exports = config;
