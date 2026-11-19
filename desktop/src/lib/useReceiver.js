import { useCallback, useEffect, useRef, useState } from 'react';
import { tuneOpus } from './sdp.js';

/**
 * Connects the renderer to the local signaling server as the "desktop" role
 * and answers the phone's WebRTC offer. Exposes the incoming MediaStream,
 * the phone's reported state, live stats and a `control()` to drive the phone.
 */
export function useReceiver(info, onPcm) {
  const [phone, setPhone] = useState(null); // { name, os, ip }
  const [phoneState, setPhoneState] = useState(null); // { mic, cam, facing, quality, voiceProcessing, hasVideo }
  const [stream, setStream] = useState(null);
  const [linkState, setLinkState] = useState('idle'); // idle | negotiating | live | lost
  const [stats, setStats] = useState(null);
  const [audioOn, setAudioOn] = useState(false);
  const pcmRef = useRef(onPcm);
  pcmRef.current = onPcm;
  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const pendingIce = useRef([]);

  const send = useCallback((msg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const closePc = useCallback(() => {
    if (pcRef.current) {
      try { pcRef.current.close(); } catch {}
    }
    pcRef.current = null;
    pendingIce.current = [];
    setStream(null);
    setStats(null);
  }, []);

  const onOffer = useCallback(
    async (sdp) => {
      closePc();
      const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
      pcRef.current = pc;
      setLinkState('negotiating');
      const remote = new MediaStream();
      setStream(remote);

      pc.onicecandidate = (e) => {
        if (e.candidate) send({ t: 'ice', candidate: e.candidate.toJSON() });
      };
      pc.ontrack = (e) => {
        // Ask Chromium to keep the jitter buffer as small as possible.
        try { e.receiver.jitterBufferTarget = 0; } catch {}
        try { e.receiver.playoutDelayHint = 0; } catch {}
        if (!remote.getTracks().includes(e.track)) remote.addTrack(e.track);
        setStream(new MediaStream(remote.getTracks()));
      };
      pc.onconnectionstatechange = () => {
        if (pc !== pcRef.current) return;
        const s = pc.connectionState;
        if (s === 'connected') setLinkState('live');
        else if (s === 'failed' || s === 'disconnected') setLinkState('lost');
      };

      await pc.setRemoteDescription({ type: 'offer', sdp });
      for (const c of pendingIce.current.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      const answer = await pc.createAnswer();
      answer.sdp = tuneOpus(answer.sdp);
      await pc.setLocalDescription(answer);
      send({ t: 'answer', sdp: answer.sdp });
    },
    [closePc, send],
  );

  // Signaling socket (reconnects if the main process restarts the server).
  useEffect(() => {
    if (!info?.port || !info?.adminSecret) return;
    let stopped = false;
    let retry;

    const connect = () => {
      const ws = new WebSocket(`ws://127.0.0.1:${info.port}/ws`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', role: 'desktop', code: info.adminSecret }));
      ws.onmessage = async (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          pcmRef.current?.(ev.data);
          return;
        }
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        switch (msg.t) {
          case 'phone-joined':
            setPhone(msg.device);
            break;
          case 'audio':
            setAudioOn(!!msg.on);
            break;
          case 'phone-left':
            setAudioOn(false);
            setPhone(null);
            setPhoneState(null);
            setLinkState('idle');
            closePc();
            break;
          case 'offer':
            await onOffer(msg.sdp).catch((err) => console.error('offer failed', err));
            break;
          case 'ice':
            if (!msg.candidate) return;
            if (pcRef.current?.remoteDescription) await pcRef.current.addIceCandidate(msg.candidate).catch(() => {});
            else pendingIce.current.push(msg.candidate);
            break;
          case 'state':
            setPhoneState({
              mic: !!msg.mic,
              cam: !!msg.cam,
              facing: msg.facing,
              quality: msg.quality,
              voiceProcessing: !!msg.voiceProcessing,
              hasVideo: !!msg.hasVideo,
              source: msg.source === 'screen' ? 'screen' : 'camera',
            });
            break;
          case 'bye':
            setLinkState('idle');
            closePc();
            break;
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        retry = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      wsRef.current?.close();
      closePc();
    };
  }, [info?.port, info?.adminSecret, onOffer, closePc]);

  // Stats loop.
  useEffect(() => {
    if (linkState !== 'live') return;
    let prev = null;
    const t = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;
      const report = await pc.getStats().catch(() => null);
      if (!report) return;
      const s = { rtt: null, kbps: null, width: null, height: null, fps: null, lossPct: null, jitterMs: null, link: null };
      let bytes = 0;
      let lost = 0;
      let received = 0;
      let localId = null;
      report.forEach((r) => {
        if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
          if (r.currentRoundTripTime != null) s.rtt = Math.round(r.currentRoundTripTime * 1000);
          localId = r.localCandidateId;
        }
        if (r.type === 'inbound-rtp') {
          bytes += r.bytesReceived || 0;
          lost += r.packetsLost || 0;
          received += r.packetsReceived || 0;
          if (r.kind === 'video') {
            s.width = r.frameWidth ?? null;
            s.height = r.frameHeight ?? null;
            s.fps = r.framesPerSecond != null ? Math.round(r.framesPerSecond) : null;
          }
          if (r.kind === 'audio' && r.jitter != null) s.jitterMs = Math.round(r.jitter * 1000);
        }
      });
      if (localId) {
        const c = report.get(localId);
        if (c) s.link = `${c.address || c.ip || ''} (${c.protocol || 'udp'})`;
      }
      const now = performance.now();
      if (prev) s.kbps = Math.max(0, Math.round(((bytes - prev.bytes) * 8) / (now - prev.at)));
      if (received + lost > 0) s.lossPct = Math.round((lost / (received + lost)) * 1000) / 10;
      prev = { bytes, at: now };
      setStats(s);
    }, 1000);
    return () => clearInterval(t);
  }, [linkState]);

  const control = useCallback((action, value) => send({ t: 'control', action, value }), [send]);
  const kick = useCallback(() => send({ t: 'kick' }), [send]);

  return { phone, phoneState, stream, linkState, audioOn, stats, control, kick };
}
