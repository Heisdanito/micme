const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PROGRESS_MS = 150;

/** Strips paths and characters Windows/macOS/Linux reject in file names. */
function safeName(name) {
  const base = path.basename(String(name || 'file')).replace(/[<>:"/\|?*\u0000-\u001f]/g, '_').trim();
  const cleaned = base.replace(/^\.+/, '').slice(0, 150);
  return cleaned || 'file';
}

async function uniquePath(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 0; i < 10000; i++) {
    const candidate = path.join(dir, i ? `${stem} (${i})${ext}` : name);
    try {
      await fs.promises.access(candidate);
    } catch {
      return candidate;
    }
  }
  return path.join(dir, `${stem}-${Date.now()}${ext}`);
}

/**
 * File transfer over plain HTTP, the same idea LocalSend uses:
 *   phone → PC   POST /api/upload?name=..&size=..   (raw body, streamed to disk)
 *   PC → phone   GET  /api/files/:id               (desktop offers files over the socket first)
 * Every request must carry the session token the phone got when it paired.
 */
function createTransfers({ downloadsDir, onEvent }) {
  const offers = new Map(); // id -> { id, name, size, path }

  const emit = (t) => onEvent({ type: 'transfer', ...t });

  function ticker(t) {
    let last = 0;
    return (force) => {
      const now = Date.now();
      if (force || now - last > PROGRESS_MS) {
        last = now;
        emit(t);
      }
    };
  }

  async function handleUpload(req, res, url) {
    const name = safeName(url.searchParams.get('name'));
    const size = Number(url.searchParams.get('size')) || Number(req.headers['content-length']) || 0;
    await fs.promises.mkdir(downloadsDir, { recursive: true });
    const finalPath = await uniquePath(downloadsDir, name);
    const partPath = `${finalPath}.part`;
    const t = { id: crypto.randomUUID(), dir: 'in', name: path.basename(finalPath), size, done: 0, state: 'active', path: finalPath };
    const tick = ticker(t);
    tick(true);

    const out = fs.createWriteStream(partPath);
    let failed = false;
    const fail = (msg) => {
      if (failed) return;
      failed = true;
      out.destroy();
      fs.promises.rm(partPath, { force: true }).catch(() => {});
      t.state = 'failed';
      t.error = msg;
      tick(true);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: msg }));
      }
    };

    req.on('data', (chunk) => {
      t.done += chunk.length;
      tick();
    });
    req.on('aborted', () => fail('Upload cancelled'));
    out.on('error', (e) => fail(e.message));
    out.on('finish', async () => {
      if (failed) return;
      try {
        await fs.promises.rename(partPath, finalPath);
        t.state = 'done';
        t.size = t.done;
        tick(true);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, name: t.name }));
      } catch (e) {
        fail(e.message);
      }
    });
    req.pipe(out);
  }

  function handleDownload(req, res, id) {
    const offer = offers.get(id);
    if (!offer) {
      res.writeHead(404).end();
      return;
    }
    const t = { id, dir: 'out', name: offer.name, size: offer.size, done: 0, state: 'active' };
    const tick = ticker(t);
    tick(true);
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': offer.size,
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(offer.name)}`,
    });
    const stream = fs.createReadStream(offer.path);
    stream.on('data', (c) => {
      t.done += c.length;
      tick();
    });
    stream.on('error', () => {
      t.state = 'failed';
      tick(true);
      res.destroy();
    });
    res.on('close', () => {
      if (t.state !== 'active') return;
      t.state = t.done >= offer.size ? 'done' : 'failed';
      if (t.state === 'failed') t.error = 'Phone stopped the download';
      tick(true);
      if (t.state === 'done') offers.delete(id);
    });
    stream.pipe(res);
  }

  async function offer(paths) {
    const files = [];
    for (const p of paths) {
      try {
        const st = await fs.promises.stat(p);
        if (!st.isFile()) continue;
        const f = { id: crypto.randomUUID(), name: safeName(path.basename(p)), size: st.size, path: p };
        offers.set(f.id, f);
        files.push({ id: f.id, name: f.name, size: f.size });
        emit({ id: f.id, dir: 'out', name: f.name, size: f.size, done: 0, state: 'queued' });
      } catch {}
    }
    return files;
  }

  function clearOffers() {
    for (const f of offers.values()) emit({ id: f.id, dir: 'out', name: f.name, size: f.size, done: 0, state: 'failed', error: 'Phone disconnected' });
    offers.clear();
  }

  return { handleUpload, handleDownload, offer, clearOffers, safeName };
}

module.exports = { createTransfers, safeName };
