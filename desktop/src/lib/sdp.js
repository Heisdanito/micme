/**
 * Tunes the Opus line of an SDP answer for a voice mic: high bitrate,
 * mono, in-band FEC for lossy Wi-Fi, no DTX gaps.
 */
export function tuneOpus(sdp, { bitrate = 128000 } = {}) {
  const m = /a=rtpmap:(\d+) opus\/48000[^\r\n]*/i.exec(sdp);
  if (!m) return sdp;
  const pt = m[1];
  const wanted = { maxaveragebitrate: String(bitrate), stereo: '0', useinbandfec: '1', usedtx: '0' };
  const fmtpRe = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  const existing = fmtpRe.exec(sdp);
  if (!existing) {
    const params = Object.entries(wanted).map(([k, v]) => `${k}=${v}`).join(';');
    return sdp.replace(m[0], `${m[0]}\r\na=fmtp:${pt} ${params}`);
  }
  const map = new Map(
    existing[1]
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((kv) => {
        const i = kv.indexOf('=');
        return i < 0 ? [kv, ''] : [kv.slice(0, i), kv.slice(i + 1)];
      }),
  );
  for (const [k, v] of Object.entries(wanted)) map.set(k, v);
  const line = `a=fmtp:${pt} ${[...map].map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join(';')}`;
  return sdp.replace(existing[0], line);
}
