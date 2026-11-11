// Android build fixes applied on every `expo prebuild` (android/ is generated, don't edit it by hand).
const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

const CMAKE_LINE = '        externalNativeBuild { cmake { arguments "-DCMAKE_OBJECT_PATH_MAX=240" } }';

module.exports = function withAndroidBuildFixes(config) {
  // R8 strips constructors that WorkManager (used by expo-background-task) loads by
  // reflection: the release app crashed on start with NoSuchMethodException
  // WorkDatabase_Impl.<init>. The app is small, so skip minification altogether.
  config = withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter(
      (item) => !(item.type === 'property' && item.key === 'android.enableMinifyInReleaseBuilds'),
    );
    cfg.modResults.push({ type: 'property', key: 'android.enableMinifyInReleaseBuilds', value: 'false' });
    return cfg;
  });

  // Windows: C++ object paths of the codegen'd native modules exceed the 260-char
  // MAX_PATH. Below this limit CMake shortens long object paths with a hash.
  config = withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('CMAKE_OBJECT_PATH_MAX')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /(defaultConfig\s*\{\n)/,
        `$1        // Windows: let CMake shorten object paths that would exceed MAX_PATH.\n${CMAKE_LINE}\n`,
      );
    }
    return cfg;
  });

  return config;
};
