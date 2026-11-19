import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tuneOpus } from '../src/lib/sdp.js';

test('tuneOpus merges voice params into the existing fmtp line', () => {
  const sdp = 'a=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=0\r\n';
  const out = tuneOpus(sdp);
  assert.match(out, /a=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=128000;stereo=0;usedtx=0/);
});

test('tuneOpus adds an fmtp line when missing', () => {
  const out = tuneOpus('a=rtpmap:109 opus/48000/2\r\n');
  assert.match(out, /a=rtpmap:109 opus\/48000\/2\r\na=fmtp:109 maxaveragebitrate=128000/);
});
