/**
 * Enables react-native-webrtc's built-in MediaProjection foreground service so
 * getDisplayMedia() (phone screen sharing) works on Android 10+.
 */
const { withMainApplication, withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const IMPORT = 'import com.oney.WebRTCModule.WebRTCModuleOptions';
const FLAG = 'WebRTCModuleOptions.getInstance().enableMediaProjectionService = true';

function withFlag(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withScreenCapture expects a Kotlin MainApplication');
    }
    if (!src.includes(IMPORT)) {
      src = src.replace(/^(package [^\n]+\n)/m, `$1\n${IMPORT}\n`);
    }
    if (!src.includes(FLAG)) {
      src = src.replace(/(override fun onCreate\(\)\s*\{\s*\n\s*super\.onCreate\(\)\s*\n)/, `$1    ${FLAG}\n`);
      if (!src.includes(FLAG)) throw new Error('withScreenCapture: could not find onCreate() in MainApplication');
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

function withPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    AndroidConfig.Permissions.ensurePermissions(cfg.modResults, [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
      'android.permission.POST_NOTIFICATIONS',
    ]);
    return cfg;
  });
}

module.exports = function withScreenCapture(config) {
  return withPermissions(withFlag(config));
};
