// Checks everything needed to develop, build and use MicMe.
// Run from the repo root:  npm run doctor
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const isWin = platform() === 'win32';
const rows = [];

const run = (cmd) => {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).toString().trim();
  } catch {
    return null;
  }
};
const add = (group, name, ok, detail, fix) => rows.push({ group, name, ok, detail, fix });

// ---- core tools ----
const nodeMajor = Number(process.versions.node.split('.')[0]);
add('Core', 'Node.js ≥ 20', nodeMajor >= 20, `v${process.versions.node}`, 'Install Node LTS from https://nodejs.org');
const npmV = run('npm -v');
add('Core', 'npm', !!npmV, npmV || 'missing', 'Comes with Node.js');
const gitV = run('git --version');
add('Core', 'git', !!gitV, gitV || 'missing', 'https://git-scm.com');

// ---- desktop ----
add('Desktop', 'desktop deps installed', existsSync(join(root, 'desktop/node_modules/electron')), 'desktop/node_modules', 'cd desktop && npm install');
const electronBin = existsSync(join(root, 'desktop/node_modules/electron/path.txt'));
add('Desktop', 'Electron binary downloaded', electronBin, electronBin ? 'ok' : 'missing', 'cd desktop && node node_modules/electron/install.js');

if (isWin) {
  const cable = run('powershell -NoProfile -Command "Get-PnpDevice -Class AudioEndpoint -ErrorAction SilentlyContinue | Where-Object FriendlyName -match \'CABLE|VB-Audio|Voicemeeter\' | Select-Object -First 1 -ExpandProperty FriendlyName"');
  add('Desktop', 'Virtual audio cable (to use phone as a mic in other apps)', !!cable, cable || 'not found (optional)', 'Install VB-CABLE: https://vb-audio.com/Cable/', true);
  const obs = existsSync('C:/Program Files/obs-studio') || existsSync(join(homedir(), 'AppData/Roaming/obs-studio'));
  add('Desktop', 'OBS Studio (to use phone as a webcam in other apps)', obs, obs ? 'found' : 'not found (optional)', 'https://obsproject.com → Window Capture + Start Virtual Camera', true);
}

// ---- mobile ----
add('Mobile', 'mobile deps installed', existsSync(join(root, 'mobile/node_modules/expo')), 'mobile/node_modules', 'cd mobile && npm install');
const easUser = run('npx --yes eas-cli@latest whoami');
add('Mobile', 'EAS account (cloud APK/IPA builds)', !!easUser, easUser || 'not logged in (optional when building locally)', 'npx eas-cli@latest login', true);
const studioJbr = isWin ? 'C:/Program Files/Android/Android Studio/jbr' : '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
const javaHome = process.env.JAVA_HOME || (existsSync(studioJbr) ? studioJbr : null);
const java = run('java --version') ?? (javaHome ? run(`"${join(javaHome, 'bin', 'java')}" --version`) : null);
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (isWin ? join(homedir(), 'AppData/Local/Android/Sdk') : join(homedir(), 'Android/Sdk'));
const hasSdk = existsSync(sdk);
add('Mobile', 'JDK 17+ (local Android builds only)', !!java, java ? java.split('\n')[0] : 'missing (optional, EAS builds in the cloud)', 'Install Android Studio (bundles a JDK) or set JAVA_HOME', true);
add('Mobile', 'Android SDK (local Android builds only)', hasSdk, hasSdk ? sdk : 'missing (optional)', 'Install Android Studio, then set ANDROID_HOME', true);
const adb = run('adb version') ?? (hasSdk ? run(`"${join(sdk, 'platform-tools', 'adb')}" version`) : null);
add('Mobile', 'adb (install APK over USB)', !!adb, adb ? adb.split('\n')[0] : 'missing (optional)', 'Android SDK platform-tools', true);

// ---- repo hygiene ----
add('Repo', 'private/ is git-ignored', !!run('git check-ignore private/x'), 'keys, keystores, .env live in private/', 'Add "private/" to .gitignore');

// ---- print ----
let group = '';
let failed = 0;
for (const r of rows) {
  if (r.group !== group) {
    group = r.group;
    console.log(`\n${group}`);
  }
  const mark = r.ok ? '✔' : r.fix && r.detail?.includes('optional') ? '○' : '✖';
  if (mark === '✖') failed++;
  console.log(`  ${mark} ${r.name.padEnd(58)} ${r.detail ?? ''}`);
  if (!r.ok) console.log(`      → ${r.fix}`);
}
console.log(`\n${failed ? `${failed} required item(s) missing.` : 'All required tools are ready.'} (○ = optional)\n`);
process.exitCode = failed ? 1 : 0;
