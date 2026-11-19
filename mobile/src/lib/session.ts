import { Platform } from 'react-native';
import {
  mediaDevices,
  MediaStream,
  MediaStreamTrack,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
} from 'react-native-webrtc';
import type { Pairing } from './pairing';
import { openFirstReachable, send, type SignalMessage } from './signaling';

export type Quality = 'low' | 'medium' | 'high';
export type Facing = 'front' | 'back';
export type Source = 'camera' | 'screen';

export const QUALITY: Record<Quality, { label: string; width: number; height: number; fps: number; kbps: number }> = {
  low: { label: '360p', width: 640, height: 360, fps: 24, kbps: 700 },
  medium: { label: '720p', width: 1280, height: 720, fps: 30, kbps: 2000 },
  high: { label: '1080p', width: 1920, height: 1080, fps: 30, kbps: 4500 },
};

export type Settings = {
  mic: boolean;
  cam: boolean;
  facing: Facing;
  quality: Quality;
  voiceProcessing: boolean;
};

export type Status = 'connecting' | 'negotiating' | 'live' | 'reconnecting' | 'error' | 'closed';

export type SessionSnapshot = {
  status: Status;
  error?: string;
  host?: string;
  computer?: string;
  settings: Settings;
  source: Source;
  /** HTTP base + token for file transfer, set once paired. */
  link?: { base: string; token: string };
  previewUrl?: string;
  rttMs?: number;
  kbps?: number;
  startedAt?: number;
};

type Listener = (s: SessionSnapshot) => void;
type FileOfferListener = (files: { id: string; name: string; size: number }[]) => void;

const MAX_RETRIES = 30;

function deviceInfo() {
  const c: any = Platform.constants || {};
  const model = Platform.OS === 'android' ? [c.Brand, c.Model].filter(Boolean).join(' ') : c.systemName || 'iPhone';
  return { name: model || Platform.OS, os: `${Platform.OS} ${Platform.Version}` };
}

export class MicMeSession {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private audioTrack: MediaStreamTrack | null = null;
  private videoTrack: MediaStreamTrack | null = null;
  private preview: MediaStream | null = null;
  private audioSender: any = null;
  private videoSender: any = null;
  private pendingIce: any[] = [];
  private remoteSet = false;
  private stopped = false;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private lastBytes = 0;
  private lastBytesAt = 0;
  private snap: SessionSnapshot;
  onFileOffer: FileOfferListener | null = null;

  constructor(private pairing: Pairing, settings: Settings, private listener: Listener) {
    this.snap = { status: 'connecting', settings: { ...settings }, source: 'camera', computer: pairing.name };
  }

  static screenShareSupported = Platform.OS === 'android';

  get link() {
    return this.snap.link;
  }

  /** Switches the video feed between the camera and the phone screen (Android). */
  async setSource(source: Source) {
    if (source === this.snap.source) return;
    if (source === 'screen') {
      const stream = await mediaDevices.getDisplayMedia({ video: true } as any);
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      const oldCam = this.videoTrack;
      const oldPreview = this.preview;
      this.videoTrack = track;
      this.preview = null;
      (track as any).addEventListener?.('ended', () => {
        if (this.videoTrack === track) this.setSource('camera').catch(() => {});
      });
      await this.videoSender?.replaceTrack(track);
      oldCam?.stop();
      oldPreview?.release?.(false);
      this.update({ source: 'screen', previewUrl: undefined });
    } else {
      const screen = this.videoTrack;
      this.videoTrack = null;
      this.update({ source: 'camera' });
      if (this.snap.settings.cam) await this.acquireVideo();
      await this.videoSender?.replaceTrack(this.videoTrack);
      screen?.stop();
    }
    this.applyBitrate();
    this.sendState();
  }

  // ---------- public API ----------

  async start() {
    this.stopped = false;
    this.retries = 0;
    try {
      await this.ensureMedia();
    } catch (e: any) {
      this.update({ status: 'error', error: `Microphone/camera unavailable: ${e?.message || e}` });
      return;
    }
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    send(this.ws, { t: 'bye' });
    this.teardownLink();
    this.audioTrack?.stop();
    this.videoTrack?.stop();
    this.audioTrack = this.videoTrack = null;
    this.preview?.release?.(false);
    this.preview = null;
    this.update({ status: 'closed', previewUrl: undefined, source: 'camera', link: undefined });
  }

  async setMic(on: boolean) {
    if (this.audioTrack) this.audioTrack.enabled = on;
    this.patchSettings({ mic: on });
  }

  async setCam(on: boolean) {
    if (on === this.snap.settings.cam) return;
    if (this.snap.source === 'screen') return;
    this.patchSettings({ cam: on });
    if (on) {
      await this.acquireVideo();
      await this.videoSender?.replaceTrack(this.videoTrack);
      this.applyBitrate();
    } else {
      await this.videoSender?.replaceTrack(null);
      this.videoTrack?.stop();
      this.videoTrack = null;
      this.preview?.release?.(false);
      this.preview = null;
      this.update({ previewUrl: undefined });
    }
    this.sendState();
  }

  async flip() {
    const facing: Facing = this.snap.settings.facing === 'front' ? 'back' : 'front';
    this.patchSettings({ facing });
    if (!this.videoTrack || this.snap.source === 'screen') return;
    try {
      (this.videoTrack as any)._switchCamera();
    } catch {
      await this.replaceVideo();
    }
  }

  async setQuality(quality: Quality) {
    this.patchSettings({ quality });
    if (this.videoTrack && this.snap.source === 'camera') await this.replaceVideo();
    this.applyBitrate();
  }

  async setVoiceProcessing(on: boolean) {
    this.patchSettings({ voiceProcessing: on });
    const old = this.audioTrack;
    await this.acquireAudio();
    await this.audioSender?.replaceTrack(this.audioTrack);
    old?.stop();
  }

  // ---------- media ----------

  private async ensureMedia() {
    if (!this.audioTrack) await this.acquireAudio();
    if (this.snap.settings.cam && this.snap.source === 'camera' && !this.videoTrack) await this.acquireVideo();
  }

  private async acquireAudio() {
    const vp = this.snap.settings.voiceProcessing;
    const stream = await mediaDevices.getUserMedia({
      audio: { echoCancellation: vp, noiseSuppression: vp, autoGainControl: vp } as any,
      video: false,
    });
    this.audioTrack = stream.getAudioTracks()[0];
    this.audioTrack.enabled = this.snap.settings.mic;
  }

  private async acquireVideo() {
    const q = QUALITY[this.snap.settings.quality];
    const stream = await mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: this.snap.settings.facing === 'front' ? 'user' : 'environment',
        width: { ideal: q.width },
        height: { ideal: q.height },
        frameRate: { ideal: q.fps },
      } as any,
    });
    this.videoTrack = stream.getVideoTracks()[0];
    this.preview = stream;
    this.update({ previewUrl: stream.toURL() });
  }

  private async replaceVideo() {
    const old = this.videoTrack;
    const oldPreview = this.preview;
    await this.acquireVideo();
    await this.videoSender?.replaceTrack(this.videoTrack);
    old?.stop();
    oldPreview?.release?.(false);
  }

  private applyBitrate() {
    const sender = this.videoSender;
    if (!sender) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) return;
      params.encodings[0].maxBitrate = QUALITY[this.snap.settings.quality].kbps * 1000;
      sender.setParameters(params).catch(() => {});
    } catch {}
  }

  // ---------- link ----------

  private async connect() {
    this.update({ status: this.retries ? 'reconnecting' : 'connecting', error: undefined });
    try {
      const { ws, host } = await openFirstReachable(this.pairing);
      if (this.stopped) {
        ws.close();
        return;
      }
      this.ws = ws;
      this.update({ host });
      ws.onmessage = (ev) => this.onSignal(ev.data);
      ws.onclose = () => this.linkLost('Connection to the computer closed.');
      ws.onerror = () => {};
      send(ws, { t: 'hello', role: 'phone', code: this.pairing.code, device: deviceInfo() });
    } catch (e: any) {
      this.linkLost(e?.message || String(e));
    }
  }

  private async onSignal(raw: any) {
    let msg: SignalMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    switch (msg.t) {
      case 'welcome':
        this.retries = 0;
        this.update({
          computer: msg.name || this.pairing.name,
          link: msg.token ? { base: `http://${this.snap.host}:${this.pairing.port}`, token: msg.token } : undefined,
        });
        await this.negotiate();
        break;
      case 'error':
        this.stopped = true;
        this.teardownLink();
        this.update({ status: 'error', error: msg.reason || 'Rejected by the computer.' });
        break;
      case 'answer':
        if (!this.pc) return;
        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: msg.sdp }));
        this.remoteSet = true;
        for (const c of this.pendingIce.splice(0)) await this.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        break;
      case 'ice':
        if (!msg.candidate) return;
        if (this.pc && this.remoteSet) await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
        else this.pendingIce.push(msg.candidate);
        break;
      case 'control':
        await this.onControl(msg.action, msg.value);
        break;
      case 'file-offer':
        if (Array.isArray(msg.files)) this.onFileOffer?.(msg.files);
        break;
      case 'renegotiate':
        await this.negotiate();
        break;
    }
  }

  private async onControl(action: string, value: any) {
    try {
      if (action === 'mic') await this.setMic(!!value);
      else if (action === 'cam') await this.setCam(!!value);
      else if (action === 'flip') await this.flip();
      else if (action === 'quality' && value in QUALITY) await this.setQuality(value);
      else if (action === 'voice') await this.setVoiceProcessing(!!value);
    } catch {}
  }

  private async negotiate() {
    this.closePc();
    await this.ensureMedia();
    const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
    this.pc = pc;
    this.remoteSet = false;
    this.pendingIce = [];
    this.update({ status: 'negotiating' });

    const stream = new MediaStream();
    this.audioSender = pc.addTransceiver(this.audioTrack as MediaStreamTrack, { direction: 'sendonly', streams: [stream] }).sender;
    this.videoSender = (
      this.videoTrack
        ? pc.addTransceiver(this.videoTrack, { direction: 'sendonly', streams: [stream] })
        : pc.addTransceiver('video', { direction: 'sendonly', streams: [stream] })
    ).sender;

    (pc as any).addEventListener('icecandidate', (e: any) => {
      if (e.candidate) send(this.ws, { t: 'ice', candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
    });
    (pc as any).addEventListener('connectionstatechange', () => {
      const st = pc.connectionState;
      if (pc !== this.pc) return;
      if (st === 'connected') {
        this.update({ status: 'live', startedAt: this.snap.startedAt || Date.now() });
        this.applyBitrate();
        this.startStats();
        this.sendState();
      } else if (st === 'failed') {
        this.linkLost('Media link failed. Retrying…');
      }
    });

    const offer = await pc.createOffer({});
    await pc.setLocalDescription(offer);
    send(this.ws, { t: 'offer', sdp: offer.sdp });
  }

  private sendState() {
    const s = this.snap.settings;
    send(this.ws, { t: 'state', ...s, source: this.snap.source, hasVideo: !!this.videoTrack });
  }

  private startStats() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.lastBytes = 0;
    this.lastBytesAt = 0;
    this.statsTimer = setInterval(async () => {
      const pc = this.pc;
      if (!pc) return;
      try {
        const report: any = await pc.getStats();
        let rtt: number | undefined;
        let bytes = 0;
        report.forEach((r: any) => {
          if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime != null) rtt = r.currentRoundTripTime * 1000;
          if (r.type === 'outbound-rtp') bytes += r.bytesSent || 0;
        });
        const now = Date.now();
        let kbps: number | undefined;
        if (this.lastBytesAt) kbps = ((bytes - this.lastBytes) * 8) / (now - this.lastBytesAt);
        this.lastBytes = bytes;
        this.lastBytesAt = now;
        this.update({ rttMs: rtt != null ? Math.round(rtt) : undefined, kbps: kbps != null ? Math.max(0, Math.round(kbps)) : undefined });
      } catch {}
    }, 2000);
  }

  private linkLost(reason: string) {
    if (this.stopped) return;
    this.teardownLink();
    this.retries += 1;
    if (this.retries > MAX_RETRIES) {
      this.update({ status: 'error', error: reason });
      return;
    }
    this.update({ status: 'reconnecting', error: reason });
    const delay = Math.min(5000, 600 * this.retries);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private closePc() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    if (this.pc) {
      try { this.pc.close(); } catch {}
    }
    this.pc = null;
    this.audioSender = this.videoSender = null;
  }

  private teardownLink() {
    this.closePc();
    if (this.ws) {
      this.ws.onmessage = this.ws.onclose = this.ws.onerror = null;
      try { this.ws.close(); } catch {}
    }
    this.ws = null;
  }

  private patchSettings(p: Partial<Settings>) {
    this.update({ settings: { ...this.snap.settings, ...p } });
    this.sendState();
  }

  private update(p: Partial<SessionSnapshot>) {
    this.snap = { ...this.snap, ...p };
    this.listener(this.snap);
  }
}
