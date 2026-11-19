const http = require('node:http');
const { WebSocketServer } = require('ws');
const crypto = require('node:crypto');
const { safeEqual } = require('./pairing.cjs');
const { createTransfers } = require('./transfers.cjs');

const PHONE_TO_DESKTOP = new Set(['offer', 'ice', 'state', 'bye']);
const DESKTOP_TO_PHONE = new Set(['answer', 'ice', 'control', 'renegotiate']);
const MAX_BAD_ATTEMPTS = 6;
const BLOCK_MS = 60_000;

function isLoopback(addr = '') {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function cleanAddr(addr = '') {
  return addr.replace(/^::ffff:/, '');
}

/**
 * Tiny signaling relay. The desktop renderer and one phone connect here and
 * swap WebRTC offer/answer/ICE messages. Media never passes through this
 * server: it flows peer-to-peer over the LAN, hotspot or USB-tether link.
 */
function createSignalingServer({ getCode, adminSecret, name, downloadsDir, onEvent = () => {} }) {
  let desktop = null;
  let phone = null;
  let phoneInfo = null;
  let phoneToken = null; // issued on pairing, required for file transfer
  const bad = new Map(); // ip -> { count, until }
  const transfers = createTransfers({ downloadsDir, onEvent: (e) => onEvent(e) });

  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const token = req.headers['x-micme-token'];
      if (!phoneToken || !token || !safeEqual(token, phoneToken)) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Not paired' }));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/upload') {
        transfers.handleUpload(req, res, url).catch(() => {
          if (!res.headersSent) res.writeHead(500).end();
        });
        return;
      }
      const m = /^\/api\/files\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (req.method === 'GET' && m) {
        transfers.handleDownload(req, res, m[1]);
        return;
      }
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`MicMe is running on ${name}. Open the MicMe phone app and scan the QR code.\n`);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  // Raw mic audio from the phone: binary PCM16 48 kHz mono frames (MicStream-style).
  const audioWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  let audioSock = null;

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else if (url.pathname === '/audio') {
      const token = url.searchParams.get('token') || '';
      if (!phoneToken || !safeEqual(token, phoneToken)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      audioWss.handleUpgrade(req, socket, head, (ws) => audioWss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  audioWss.on('connection', (ws) => {
    if (audioSock && audioSock !== ws) audioSock.terminate();
    audioSock = ws;
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    sendTo(desktop, { t: 'audio', on: true });
    ws.on('message', (data, isBinary) => {
      if (!isBinary) return;
      if (desktop && desktop.readyState === desktop.OPEN && desktop.bufferedAmount < 256 * 1024) {
        desktop.send(data, { binary: true });
      }
    });
    ws.on('close', () => {
      if (audioSock === ws) {
        audioSock = null;
        sendTo(desktop, { t: 'audio', on: false });
      }
    });
    ws.on('error', () => {});
  });

  const sendTo = (ws, msg) => {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const blocked = (ip) => {
    const b = bad.get(ip);
    return b && b.until > Date.now();
  };

  const strike = (ip) => {
    const b = bad.get(ip) || { count: 0, until: 0 };
    b.count += 1;
    if (b.count >= MAX_BAD_ATTEMPTS) {
      b.until = Date.now() + BLOCK_MS;
      b.count = 0;
    }
    bad.set(ip, b);
  };

  wss.on('connection', (ws, req) => {
    const ip = cleanAddr(req.socket.remoteAddress);
    let role = null;
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));

    const helloTimer = setTimeout(() => {
      if (!role) ws.close(4000, 'hello timeout');
    }, 6000);

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;

      if (!role) {
        if (msg.t !== 'hello') return;
        clearTimeout(helloTimer);

        if (msg.role === 'desktop') {
          if (!isLoopback(req.socket.remoteAddress) || !safeEqual(msg.code, adminSecret)) {
            ws.close(4003, 'forbidden');
            return;
          }
          if (desktop && desktop !== ws) desktop.close(4001, 'replaced');
          desktop = ws;
          role = 'desktop';
          sendTo(ws, { t: 'welcome' });
          if (phone) {
            sendTo(desktop, { t: 'phone-joined', device: phoneInfo });
            sendTo(phone, { t: 'renegotiate' });
            if (audioSock) sendTo(desktop, { t: 'audio', on: true });
          }
          return;
        }

        if (msg.role === 'phone') {
          if (blocked(ip)) {
            sendTo(ws, { t: 'error', reason: 'Too many wrong codes. Wait a minute and try again.' });
            ws.close(4029, 'blocked');
            return;
          }
          const code = String(msg.code || '').toUpperCase();
          if (!safeEqual(code, getCode())) {
            strike(ip);
            sendTo(ws, { t: 'error', reason: 'Wrong or expired pairing code. Scan the QR code again.' });
            ws.close(4003, 'bad code');
            onEvent({ type: 'rejected', ip });
            return;
          }
          bad.delete(ip);
          // A newer phone (or the same phone reconnecting) takes over.
          if (phone && phone !== ws) {
            sendTo(phone, { t: 'error', reason: 'Another phone connected to this computer.' });
            phone.close(4001, 'replaced');
          }
          phone = ws;
          role = 'phone';
          const d = msg.device && typeof msg.device === 'object' ? msg.device : {};
          phoneInfo = { name: String(d.name || 'Phone').slice(0, 64), os: String(d.os || '').slice(0, 32), ip };
          phoneToken = crypto.randomBytes(24).toString('hex');
          sendTo(ws, { t: 'welcome', name, token: phoneToken });
          sendTo(desktop, { t: 'phone-joined', device: phoneInfo });
          onEvent({ type: 'phone-joined', device: phoneInfo });
          return;
        }

        ws.close(4002, 'unknown role');
        return;
      }

      if (role === 'phone' && PHONE_TO_DESKTOP.has(msg.t)) sendTo(desktop, msg);
      else if (role === 'desktop' && DESKTOP_TO_PHONE.has(msg.t)) sendTo(phone, msg);
      else if (role === 'desktop' && msg.t === 'kick' && phone) {
        sendTo(phone, { t: 'error', reason: 'Disconnected from the computer.' });
        phone.close(4001, 'kicked');
      }
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (role === 'phone' && phone === ws) {
        phone = null;
        phoneInfo = null;
        phoneToken = null;
        if (audioSock) audioSock.close();
        transfers.clearOffers();
        sendTo(desktop, { t: 'phone-left' });
        onEvent({ type: 'phone-left' });
      } else if (role === 'desktop' && desktop === ws) {
        desktop = null;
      }
    });
    ws.on('error', () => {});
  });

  const heartbeat = setInterval(() => {
    for (const ws of [...wss.clients, ...audioWss.clients]) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, 5000);

  function listen(startPort = 8787, attempts = 10) {
    return new Promise((resolve, reject) => {
      let port = startPort;
      const tryPort = () => {
        const onError = (err) => {
          httpServer.off('listening', onListening);
          if (err.code === 'EADDRINUSE' && port < startPort + attempts - 1) {
            port += 1;
            tryPort();
          } else reject(err);
        };
        const onListening = () => {
          httpServer.off('error', onError);
          resolve(port);
        };
        httpServer.once('error', onError);
        httpServer.once('listening', onListening);
        httpServer.listen(port, '0.0.0.0');
      };
      tryPort();
    });
  }

  function kickPhone(reason = 'Disconnected from the computer.') {
    if (phone) {
      sendTo(phone, { t: 'error', reason });
      phone.close(4001, 'kicked');
    }
  }

  /** Offers local files to the paired phone; it downloads them over HTTP. */
  async function sendFiles(paths) {
    if (!phone) throw new Error('No phone connected');
    const files = await transfers.offer(paths);
    if (files.length) sendTo(phone, { t: 'file-offer', files });
    return files.length;
  }

  function close() {
    clearInterval(heartbeat);
    for (const ws of [...wss.clients, ...audioWss.clients]) ws.terminate();
    wss.close();
    audioWss.close();
    return new Promise((r) => httpServer.close(() => r()));
  }

  return { listen, close, kickPhone, sendFiles, hasPhone: () => !!phone };
}

module.exports = { createSignalingServer };
