const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { newCode, pairingUrl, ALPHABET } = require('../electron/pairing.cjs');
const { classify } = require('../electron/network.cjs');
const { safeName } = require('../electron/transfers.cjs');
const { createSignalingServer } = require('../electron/server.cjs');

test('pairing codes use the unambiguous alphabet', () => {
  for (let i = 0; i < 200; i++) {
    const c = newCode();
    assert.equal(c.length, 6);
    for (const ch of c) assert.ok(ALPHABET.includes(ch));
  }
});

test('pairing url matches the mobile parser format', () => {
  const url = pairingUrl({ hosts: ['192.168.43.5', '192.168.42.10'], port: 8787, code: 'ABC234', name: 'MY PC' });
  assert.equal(url, 'micme://pair?h=192.168.43.5,192.168.42.10&p=8787&c=ABC234&n=MY%20PC');
});

test('network classification', () => {
  assert.equal(classify('Ethernet 4', '192.168.42.129').kind, 'usb');
  assert.equal(classify('Wi-Fi', '192.168.43.20').kind, 'hotspot');
  assert.equal(classify('Wi-Fi', '172.20.10.3').kind, 'hotspot');
  assert.equal(classify('Local Area Connection* 10', '192.168.137.1').kind, 'pc-hotspot');
  assert.equal(classify('Wi-Fi', '10.0.0.4').kind, 'wifi');
});

test('safeName strips paths and reserved characters', () => {
  assert.equal(safeName('../../etc/passwd'), 'passwd');
  assert.equal(safeName('dir/a:b*c?.txt'), 'a_b_c_.txt');
  assert.equal(safeName('a<b>|"c.txt'), 'a_b___c.txt');
  assert.equal(safeName('...'), 'file');
});

function open(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const inbox = [];
    const waiters = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      const w = waiters.shift();
      if (w) w(m);
      else inbox.push(m);
    });
    ws.next = () => new Promise((r) => (inbox.length ? r(inbox.shift()) : waiters.push(r)));
    ws.send2 = (m) => ws.send(JSON.stringify(m));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

test('signaling: rejects bad code, relays offer/answer, gates file API by token', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micme-'));
  const srv = createSignalingServer({ getCode: () => 'ABC234', adminSecret: 'secret', name: 'test-pc', downloadsDir: dir });
  const port = await srv.listen(18787);
  try {
    const desk = await open(port);
    desk.send2({ t: 'hello', role: 'desktop', code: 'secret' });
    assert.equal((await desk.next()).t, 'welcome');

    const bad = await open(port);
    bad.send2({ t: 'hello', role: 'phone', code: 'ZZZZZZ' });
    assert.equal((await bad.next()).t, 'error');

    const phone = await open(port);
    phone.send2({ t: 'hello', role: 'phone', code: 'abc234', device: { name: 'Pixel' } });
    const welcome = await phone.next();
    assert.equal(welcome.t, 'welcome');
    assert.ok(welcome.token);
    assert.equal((await desk.next()).t, 'phone-joined');

    phone.send2({ t: 'offer', sdp: 'v=0' });
    assert.deepEqual(await desk.next(), { t: 'offer', sdp: 'v=0' });
    desk.send2({ t: 'answer', sdp: 'v=1' });
    assert.deepEqual(await phone.next(), { t: 'answer', sdp: 'v=1' });

    // Upload without token is refused, with token is stored.
    const denied = await fetch(`http://127.0.0.1:${port}/api/upload?name=a.txt`, { method: 'POST', body: 'x' });
    assert.equal(denied.status, 401);
    const ok = await fetch(`http://127.0.0.1:${port}/api/upload?name=../hello.txt&size=5`, {
      method: 'POST',
      body: 'hello',
      headers: { 'x-micme-token': welcome.token },
    });
    assert.equal(ok.status, 200);
    assert.equal(fs.readFileSync(path.join(dir, 'hello.txt'), 'utf8'), 'hello');

    // Desktop → phone offer, then download.
    const src = path.join(dir, 'to-phone.bin');
    fs.writeFileSync(src, Buffer.alloc(1000, 7));
    assert.equal(await srv.sendFiles([src]), 1);
    const offer = await phone.next();
    assert.equal(offer.t, 'file-offer');
    const dl = await fetch(`http://127.0.0.1:${port}/api/files/${offer.files[0].id}`, { headers: { 'x-micme-token': welcome.token } });
    assert.equal((await dl.arrayBuffer()).byteLength, 1000);

    // Raw PCM audio: token required, binary frames relayed to the desktop.
    const denyAudio = await new Promise((resolve) => {
      const a = new WebSocket(`ws://127.0.0.1:${port}/audio?token=wrong`);
      a.on('error', () => resolve('rejected'));
      a.on('open', () => resolve('opened'));
    });
    assert.equal(denyAudio, 'rejected');

    const audio = new WebSocket(`ws://127.0.0.1:${port}/audio?token=${welcome.token}`);
    const gotPcm = new Promise((resolve) => {
      desk.removeAllListeners('message');
      desk.on('message', (d, isBinary) => {
        if (isBinary) resolve(d);
      });
    });
    await new Promise((r) => audio.on('open', r));
    const frame = Buffer.alloc(1920, 3); // one 20 ms PCM16 frame
    audio.send(frame);
    const relayed = await gotPcm;
    assert.equal(relayed.length, 1920);
    assert.equal(relayed[0], 3);
    audio.close();

    for (const ws of [desk, bad, phone]) ws.close();
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
