const { app, BrowserWindow, ipcMain, shell, session, Menu, dialog } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSignalingServer } = require('./server.cjs');
const { listAddresses } = require('./network.cjs');
const { newCode, pairingUrl } = require('./pairing.cjs');
const { createAdbBridge } = require('./adb.cjs');

// Advertise real LAN IPs in ICE candidates instead of *.local mDNS names,
// which phones on a hotspot/USB link often cannot resolve.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const adminSecret = crypto.randomBytes(24).toString('hex');
const computerName = os.hostname();
let code = newCode();
let port = 0;
let addresses = [];
let win = null;
let server = null;
let adbBridge = null;
let usbDevices = [];

function info() {
  const hosts = addresses.map((a) => a.address);
  // Phones plugged in with USB debugging reach us at 127.0.0.1 via `adb reverse`.
  if (usbDevices.length) hosts.unshift('127.0.0.1');
  else hosts.push('127.0.0.1');
  return {
    name: computerName,
    code,
    port,
    addresses,
    usbDevices,
    adbAvailable: !!adbBridge?.available,
    adminSecret,
    url: hosts.length ? pairingUrl({ hosts, port, code, name: computerName }) : null,
    version: app.getVersion(),
  };
}

function pushInfo() {
  if (win && !win.isDestroyed()) win.webContents.send('micme:info', info());
}

function refreshAddresses() {
  const next = listAddresses();
  const changed = JSON.stringify(next) !== JSON.stringify(addresses);
  addresses = next;
  if (changed) pushInfo();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#0B0D12',
    title: 'MicMe',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!DEV_URL || !url.startsWith(DEV_URL)) e.preventDefault();
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

function downloadsDir() {
  return path.join(app.getPath('downloads'), 'MicMe');
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

ipcMain.handle('micme:info', () => info());
ipcMain.handle('micme:new-code', () => {
  code = newCode();
  server?.kickPhone('The computer generated a new pairing code. Scan again.');
  pushInfo();
  return info();
});
ipcMain.handle('micme:refresh-network', () => {
  refreshAddresses();
  return info();
});
ipcMain.handle('micme:save-recording', async (_e, bytes, ext) => {
  const safeExt = ext === 'mp4' ? 'mp4' : 'webm';
  const dir = path.join(app.getPath('videos'), 'MicMe');
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, `MicMe-${stamp()}.${safeExt}`);
  await fs.promises.writeFile(file, Buffer.from(bytes));
  shell.showItemInFolder(file);
  return file;
});
ipcMain.handle('micme:send-files', async (_e, paths) => {
  if (!server?.hasPhone()) return { ok: false, error: 'Connect a phone first.' };
  let list = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : [];
  if (!list.length) {
    const r = await dialog.showOpenDialog(win, { title: 'Send files to phone', properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return { ok: false };
    list = r.filePaths;
  }
  const count = await server.sendFiles(list);
  return { ok: count > 0, count };
});
ipcMain.handle('micme:open-downloads', async () => {
  await fs.promises.mkdir(downloadsDir(), { recursive: true });
  shell.openPath(downloadsDir());
});
ipcMain.handle('micme:show-file', (_e, file) => {
  if (typeof file === 'string' && file.startsWith(downloadsDir())) shell.showItemInFolder(file);
});
ipcMain.handle('micme:open-external', (_e, url) => {
  if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
});
ipcMain.handle('micme:always-on-top', (_e, on) => {
  win?.setAlwaysOnTop(!!on);
  return !!on;
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  const allowed = new Set(['media', 'speaker-selection', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));

  server = createSignalingServer({
    getCode: () => code,
    adminSecret,
    name: computerName,
    downloadsDir: downloadsDir(),
    onEvent: (e) => {
      if (e.type === 'transfer' && win && !win.isDestroyed()) win.webContents.send('micme:transfer', e);
    },
  });
  try {
    port = await server.listen(8787);
  } catch (err) {
    console.error('MicMe could not open a port:', err);
  }
  addresses = listAddresses();
  setInterval(refreshAddresses, 4000);
  if (port) {
    adbBridge = createAdbBridge({
      port,
      onChange: (list) => {
        usbDevices = list;
        pushInfo();
      },
    });
    adbBridge.start();
  }

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  adbBridge?.stop();
  server?.close();
});
