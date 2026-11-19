import { useEffect, useRef, useState } from 'react';

const VIRTUAL_RE = /cable input|vb-audio|voicemeeter|virtual|blackhole|loopback/i;

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
 * Routes the phone's audio: phone → gain (0–300%) → chosen output device
 * (e.g. "CABLE Input" so other apps see it as a microphone), plus an
 * optional monitor copy on the default speakers.
 */
export function useAudioEngine(stream, { outputId, gain, monitor }) {
  const [engine, setEngine] = useState(null); // { analyser, outStream }
  const parts = useRef(null);

  useEffect(() => {
    const tracks = stream ? stream.getAudioTracks() : [];
    if (!tracks.length) {
      setEngine(null);
      return;
    }
    const raw = new MediaStream(tracks);
    // Chromium only feeds remote WebRTC audio into WebAudio when the stream
    // is also attached to a media element, so keep a muted one alive.
    const sinkEl = new Audio();
    sinkEl.muted = true;
    sinkEl.srcObject = raw;
    sinkEl.play().catch(() => {});

    const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
    const src = ctx.createMediaStreamSource(raw);
    const gainNode = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    const dest = ctx.createMediaStreamDestination();
    src.connect(gainNode);
    gainNode.connect(analyser);
    gainNode.connect(dest);

    const outEl = new Audio();
    outEl.srcObject = dest.stream;
    const monEl = new Audio();
    monEl.srcObject = dest.stream;

    parts.current = { ctx, gainNode, outEl, monEl, sinkEl };
    setEngine({ analyser, outStream: dest.stream });
    ctx.resume().catch(() => {});

    return () => {
      for (const el of [outEl, monEl, sinkEl]) {
        el.pause();
        el.srcObject = null;
      }
      ctx.close().catch(() => {});
      parts.current = null;
      setEngine(null);
    };
  }, [stream]);

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
    // Only needed when the main output is not already the speakers.
    const needMonitor = monitor && outputId && outputId !== 'default';
    if (needMonitor) p.monEl.play().catch(() => {});
    else p.monEl.pause();
  }, [monitor, outputId, engine]);

  return engine;
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
