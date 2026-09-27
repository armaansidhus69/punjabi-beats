/**
 * ESLint config — `npm run lint` (ya `npx eslint . --ext .js,.jsx,.ts,.tsx`)
 * 'expo' = eslint-config-expo (TypeScript + React + React Native + hooks rules).
 * SDK 51 classic config (ESLint 8, .eslintrc format).
 */
module.exports = {
  root: true,
  extends: ['expo'],
  ignorePatterns: ['node_modules/', '.expo/', 'dist/', '*.config.js'],
};
