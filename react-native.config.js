// expo-router installs these as optional peers, but the app never uses them:
// they're only needed by the JS stack and the drawer layout. Not linking their
// native code makes builds faster and avoids Windows' 260-character path limit
// (gesture-handler's C++ codegen folders are too deep to build on Windows).
// If you ever add expo-router/drawer or JSStack, remove the matching entries.
const notLinked = { platforms: { android: null, ios: null } };

module.exports = {
  dependencies: {
    'react-native-gesture-handler': notLinked,
    'react-native-reanimated': notLinked,
    'react-native-worklets': notLinked,
  },
};
