import { useCallback, useEffect, useRef, useState } from 'react';
import workletSource from './pcm-worklet.js?raw';

const VIRTUAL_RE = /cable input|vb-audio|voicemeeter|virtual|blackhole|loopback/i;
const SAMPLE_RATE = 48000;

export function isVirtualDevice(label = '') {
  return VIRTUAL_RE.test(label);
}

/** Lists audio outputs and keeps the list fresh when devices change. */
export function useOutputDevices() {
  const [devices, setDevices] = useState([]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        if (!alive) return;
        setDevices(
          all
            .filter((d) => d.kind === 'audiooutput')
            .map((d) => ({ id: d.deviceId, label: d.label || (d.deviceId === 'default' ? 'System default' : 'Output device') })),
        );
      } catch {
        setDevices([]);
      }
    };
    load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => {
      alive = false;
      navigator.mediaDevices.removeEventListener('devicechange', load);
    };
  }, []);
  return devices;
}

/**
 * Plays the phone's raw PCM stream:
 *   PCM16 frames → AudioWorklet jitter buffer → gain (0–300%) → analyser
 *                                                          ↘ output device (e.g. CABLE Input) + optional monitor
 * `push(arrayBuffer)` feeds one binary frame from the socket.
 */
export function useAudioEngine(active, { outputId, gain, monitor }) {
  const [engine, setEngine] = useState(null); // { analyser, outStream }
  const [health, setHealth] = useState({ bufferMs: 0, underruns: 0, kbps: 0 });
  const parts = useRef(null);
  const bytes = useRef({ n: 0, at: performance.now() });

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: SAMPLE_RATE });
    const url = URL.createObjectURL(new Blob([workletSource], { type: 'application/javascript' }));
    let outEl;
    let monEl;

    ctx.audioWorklet
      .addModule(url)
      .then(() => {
        if (disposed) return;
        const player = new AudioWorkletNode(ctx, 'pcm-player', { numberOfInputs: 0, outputChannelCount: [1] });
        player.port.onmessage = (e) => setHealth((h) => ({ ...h, ...e.data }));
        const gainNode = ctx.createGain();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        const dest = ctx.createMediaStreamDestination();
        player.connect(gainNode);
        gainNode.connect(analyser);
        gainNode.connect(dest);

        outEl = new Audio();
        outEl.srcObject = dest.stream;
        monEl = new Audio();
        monEl.srcObject = dest.stream;

        parts.current = { ctx, player, gainNode, outEl, monEl };
        setEngine({ analyser, outStream: dest.stream });
        ctx.resume().catch(() => {});
      })
      .catch((err) => console.error('audio worklet failed', err));

    const meter = setInterval(() => {
      const now = performance.now();
      const b = bytes.current;
      const kbps = Math.round((b.n * 8) / (now - b.at));
      bytes.current = { n: 0, at: now };
      setHealth((h) => ({ ...h, kbps }));
    }, 1000);

    return () => {
      disposed = true;
      clearInterval(meter);
      for (const el of [outEl, monEl]) {
        if (!el) continue;
        el.pause();
        el.srcObject = null;
      }
      ctx.close().catch(() => {});
      URL.revokeObjectURL(url);
      parts.current = null;
      setEngine(null);
      setHealth({ bufferMs: 0, underruns: 0, kbps: 0 });
    };
  }, [active]);

  useEffect(() => {
    const p = parts.current;
    if (p) p.gainNode.gain.setTargetAtTime(gain, p.ctx.currentTime, 0.02);
  }, [gain, engine]);

  useEffect(() => {
    const p = parts.current;
    if (!p) return;
    const id = outputId && outputId !== 'default' ? outputId : '';
    (p.outEl.setSinkId ? p.outEl.setSinkId(id) : Promise.resolve())
      .catch(() => {})
      .finally(() => p.outEl.play().catch(() => {}));
  }, [outputId, engine]);

  useEffect(() => {
    const p = parts.current;
    if (!p) return;
    const needMonitor = monitor && outputId && outputId !== 'default';
    if (needMonitor) p.monEl.play().catch(() => {});
    else p.monEl.pause();
  }, [monitor, outputId, engine]);

  /** Feed one little-endian PCM16 frame. */
  const push = useCallback((buf) => {
    bytes.current.n += buf.byteLength;
    const p = parts.current;
    if (!p) return;
    const pcm = new Int16Array(buf);
    const f = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 32768;
    p.player.port.postMessage(f, [f.buffer]);
  }, []);

  return { engine, health, push };
}

/** Records the incoming video (if any) plus processed audio to a webm file. */
export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [startedAt, setStartedAt] = useState(null);
  const rec = useRef(null);

  const start = (videoStream, audioStream) => {
    const tracks = [
      ...(videoStream ? videoStream.getVideoTracks() : []),
      ...(audioStream ? audioStream.getAudioTracks() : []),
    ];
    if (!tracks.length) return;
    const hasVideo = tracks.some((t) => t.kind === 'video');
    const candidates = hasVideo
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['audio/webm;codecs=opus', 'audio/webm'];
    const mimeType = candidates.find((m) => MediaRecorder.isTypeSupported(m));
    const r = new MediaRecorder(new MediaStream(tracks), { mimeType, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 160_000 });
    const chunks = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      const blob = new Blob(chunks, { type: mimeType });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await window.micme?.saveRecording(bytes, 'webm');
    };
    r.start(1000);
    rec.current = r;
    setRecording(true);
    setStartedAt(Date.now());
  };

  const stop = () => {
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
    rec.current = null;
    setRecording(false);
    setStartedAt(null);
  };

  return { recording, startedAt, start, stop };
}
