/**
 * Android WebRTC setup:
 *  - enables react-native-webrtc's MediaProjection foreground service so
 *    getDisplayMedia() (phone screen sharing) works on Android 10+
 *  - lets ICE use hotspot / USB-tether interfaces (see FLAG below)
 */
const { withMainApplication, withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const IMPORT = 'import com.oney.WebRTCModule.WebRTCModuleOptions';
// Second line: by default Android's WebRTC ignores network interfaces that
// ConnectivityManager doesn't report, which includes the phone's own hotspot
// and USB-tethering interfaces. Without this, ICE only tries mobile data.
const FLAG =
  'WebRTCModuleOptions.getInstance().enableMediaProjectionService = true\n' +
  '    WebRTCModuleOptions.getInstance().fieldTrials = "WebRTC-AndroidNetworkMonitor-IsAdapterAvailable/Disabled/"';

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
