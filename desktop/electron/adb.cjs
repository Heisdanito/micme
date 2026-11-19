const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Finds adb on PATH or in the default Android SDK location. */
function findAdb() {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT ||
    (process.platform === 'win32' ? path.join(os.homedir(), 'AppData/Local/Android/Sdk') : path.join(os.homedir(), 'Android/Sdk'));
  const candidates = [path.join(sdk, 'platform-tools', exe)];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) if (dir) candidates.push(path.join(dir, exe));
  return candidates.find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

const run = (adb, args) =>
  new Promise((resolve) => execFile(adb, args, { timeout: 5000, windowsHide: true }, (err, out) => resolve(err ? null : String(out))));

/**
 * Plain-USB mode (like MicStream's USB option): for each Android phone with
 * USB debugging on, forward phone:127.0.0.1:<port> to this PC. The phone then
 * reaches MicMe at 127.0.0.1 over the cable, no network needed.
 */
function createAdbBridge({ port, onChange }) {
  const adb = findAdb();
  let devices = [];
  let timer = null;

  async function tick() {
    if (!adb) return;
    const out = await run(adb, ['devices', '-l']);
    if (out == null) return;
    const list = out
      .split(/\r?\n/)
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => /\sdevice(\s|$)/.test(l))
      .map((l) => {
        const serial = l.split(/\s+/)[0];
        const model = (/model:(\S+)/.exec(l) || [])[1];
        return { serial, model: model ? model.replace(/_/g, ' ') : serial };
      });
    for (const d of list) {
      const existing = await run(adb, ['-s', d.serial, 'reverse', '--list']);
      if (!existing || !existing.includes(`tcp:${port}`)) await run(adb, ['-s', d.serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
    }
    const changed = JSON.stringify(list) !== JSON.stringify(devices);
    devices = list;
    if (changed) onChange(devices);
  }

  function start() {
    if (!adb) return;
    tick();
    timer = setInterval(tick, 3000);
  }

  function stop() {
    clearInterval(timer);
  }

  return { start, stop, available: !!adb, devices: () => devices };
}

module.exports = { createAdbBridge, findAdb };
