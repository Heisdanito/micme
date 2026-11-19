import { Camera } from 'expo-camera';
import { Platform } from 'react-native';
import {
  mediaDevices,
  MediaStream,
  MediaStreamTrack,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
} from 'react-native-webrtc';
import MicmeAudio, { type AudioState } from '../../modules/micme-audio';
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

/** Session = paired with the computer over the signaling socket. */
export type Status = 'connecting' | 'connected' | 'reconnecting' | 'error' | 'closed';
/** Video = WebRTC link for camera / screen (only while one of them is on). */
export type VideoStatus = 'off' | 'connecting' | 'live' | 'retrying';

export type SessionSnapshot = {
  status: Status;
  error?: string;
  host?: string;
  computer?: string;
  settings: Settings;
  source: Source;
  audio: AudioState | 'off';
  audioError?: string;
  level: number;
  video: VideoStatus;
  link?: { base: string; token: string };
  previewUrl?: string;
  rttMs?: number;
  startedAt?: number;
};

type Listener = (s: SessionSnapshot) => void;
type FileOfferListener = (files: { id: string; name: string; size: number }[]) => void;

const MAX_RETRIES = 40;

function deviceInfo() {
  const c: any = Platform.constants || {};
  const model = Platform.OS === 'android' ? [c.Brand, c.Model].filter(Boolean).join(' ') : c.systemName || 'iPhone';
  return { name: model || Platform.OS, os: `${Platform.OS} ${Platform.Version}` };
}

export class MicMeSession {
  static screenShareSupported = Platform.OS === 'android';

  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private videoTrack: MediaStreamTrack | null = null;
  private preview: MediaStream | null = null;
  private videoSender: any = null;
  private pendingIce: any[] = [];
  private remoteSet = false;
  private stopped = false;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private videoRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private subs: { remove(): void }[] = [];
  private snap: SessionSnapshot;
  onFileOffer: FileOfferListener | null = null;

  constructor(private pairing: Pairing, settings: Settings, private listener: Listener) {
    this.snap = { status: 'connecting', settings: { ...settings }, source: 'camera', audio: 'off', level: 0, video: 'off', computer: pairing.name };
  }

  get link() {
    return this.snap.link;
  }

  // ================= lifecycle =================

  async start() {
    this.stopped = false;
    this.retries = 0;
    const mic = await Camera.requestMicrophonePermissionsAsync().catch(() => null);
    if (!mic?.granted) {
      this.update({ status: 'error', error: 'MicMe needs microphone access. Allow it in Settings › Apps › MicMe › Permissions.' });
      return;
    }
    if (MicmeAudio) {
      this.subs.push(
        MicmeAudio.addListener('onState', ({ state, message }) => {
          this.update({ audio: state, audioError: message || undefined });
          if (state === 'streaming' && !this.snap.startedAt) this.update({ startedAt: Date.now() });
        }),
        MicmeAudio.addListener('onLevel', ({ level }) => this.update({ level })),
      );
    }
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.videoRetryTimer) clearTimeout(this.videoRetryTimer);
    send(this.ws, { t: 'bye' });
    MicmeAudio?.stop();
    for (const s of this.subs) s.remove();
    this.subs = [];
    this.teardownLink();
    this.stopVideoTrack();
    this.update({ status: 'closed', audio: 'off', video: 'off', previewUrl: undefined, source: 'camera', link: undefined, level: 0 });
  }

  // ================= controls =================

  async setMic(on: boolean) {
    MicmeAudio?.setMuted(!on);
    this.patchSettings({ mic: on });
  }

  async setVoiceProcessing(on: boolean) {
    MicmeAudio?.setVoiceProcessing(on);
    this.patchSettings({ voiceProcessing: on });
  }

  async setCam(on: boolean) {
    if (this.snap.source === 'screen') return;
    this.patchSettings({ cam: on });
    if (on) {
      await this.acquireCamera();
      await this.syncVideoLink();
    } else {
      this.stopVideoTrack();
      this.closePc();
      this.update({ video: 'off' });
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
      await this.acquireCamera();
      await this.videoSender?.replaceTrack(this.videoTrack);
    }
  }

  async setQuality(quality: Quality) {
    this.patchSettings({ quality });
    if (this.videoTrack && this.snap.source === 'camera') {
      await this.acquireCamera();
      await this.videoSender?.replaceTrack(this.videoTrack);
    }
    this.applyBitrate();
  }

  /** Switches the video between camera and phone screen (Android only). */
  async setSource(source: Source) {
    if (source === this.snap.source) return;
    if (source === 'screen') {
      if (!MicMeSession.screenShareSupported) return;
      const stream = await mediaDevices.getDisplayMedia({ video: true } as any);
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      this.stopVideoTrack();
      this.videoTrack = track;
      (track as any).addEventListener?.('ended', () => {
        if (this.videoTrack === track) this.setSource('camera').catch(() => {});
      });
      this.update({ source: 'screen', previewUrl: undefined });
    } else {
      this.stopVideoTrack();
      this.update({ source: 'camera' });
      if (this.snap.settings.cam) await this.acquireCamera();
    }
    await this.syncVideoLink();
    this.sendState();
  }

  // ================= media =================

  private stopVideoTrack() {
    this.videoTrack?.stop();
    this.videoTrack = null;
    this.preview?.release?.(false);
    this.preview = null;
    this.update({ previewUrl: undefined });
  }

  private async acquireCamera() {
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
    const old = this.videoTrack;
    const oldPreview = this.preview;
    this.videoTrack = stream.getVideoTracks()[0];
    this.preview = stream;
    this.update({ previewUrl: stream.toURL() });
    old?.stop();
    oldPreview?.release?.(false);
  }

  private applyBitrate() {
    const sender = this.videoSender;
    if (!sender) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) return;
      params.encodings[0].maxBitrate = (this.snap.source === 'screen' ? 3000 : QUALITY[this.snap.settings.quality].kbps) * 1000;
      sender.setParameters(params).catch(() => {});
    } catch {}
  }

  // ================= signaling =================

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
      ws.onmessage = (ev) => this.onSignal(ev.data).catch(() => {});
      ws.onclose = () => this.linkLost('Lost connection to the computer.');
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
      case 'welcome': {
        this.retries = 0;
        const base = `http://${this.snap.host}:${this.pairing.port}`;
        this.update({
          status: 'connected',
          computer: msg.name || this.pairing.name,
          link: msg.token ? { base, token: msg.token } : undefined,
        });
        if (msg.token && MicmeAudio) {
          MicmeAudio.start(`ws://${this.snap.host}:${this.pairing.port}/audio?token=${msg.token}`, this.snap.settings.voiceProcessing);
          MicmeAudio.setMuted(!this.snap.settings.mic);
        } else if (!MicmeAudio) {
          this.update({ audio: 'error', audioError: 'Audio streaming is only available on Android for now.' });
        }
        this.sendState();
        if (this.snap.settings.cam && this.snap.source === 'camera' && !this.videoTrack) await this.acquireCamera().catch(() => {});
        await this.syncVideoLink();
        break;
      }
      case 'error':
        this.stopped = true;
        MicmeAudio?.stop();
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
        await this.onControl(msg.action, msg.value).catch(() => {});
        break;
      case 'file-offer':
        if (Array.isArray(msg.files)) this.onFileOffer?.(msg.files);
        break;
      case 'renegotiate':
        this.sendState();
        await this.syncVideoLink(true);
        break;
    }
  }

  private async onControl(action: string, value: any) {
    if (action === 'mic') await this.setMic(!!value);
    else if (action === 'cam') await this.setCam(!!value);
    else if (action === 'flip') await this.flip();
    else if (action === 'quality' && value in QUALITY) await this.setQuality(value);
    else if (action === 'voice') await this.setVoiceProcessing(!!value);
    else if (action === 'source' && (value === 'camera' || value === 'screen')) await this.setSource(value);
  }

  // ================= video link (WebRTC) =================

  /** Opens the WebRTC link when there is something to show, closes it otherwise. */
  private async syncVideoLink(force = false) {
    if (!this.ws || this.snap.status !== 'connected') return;
    if (!this.videoTrack) {
      this.closePc();
      this.update({ video: 'off' });
      return;
    }
    if (this.pc && !force) {
      await this.videoSender?.replaceTrack(this.videoTrack);
      this.applyBitrate();
      return;
    }
    await this.negotiate();
  }

  private async negotiate() {
    this.closePc();
    if (!this.videoTrack) return;
    const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
    this.pc = pc;
    this.remoteSet = false;
    this.pendingIce = [];
    this.update({ video: 'connecting' });

    const stream = new MediaStream();
    this.videoSender = pc.addTransceiver(this.videoTrack, { direction: 'sendonly', streams: [stream] }).sender;

    (pc as any).addEventListener('icecandidate', (e: any) => {
      if (e.candidate) send(this.ws, { t: 'ice', candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
    });
    (pc as any).addEventListener('connectionstatechange', () => {
      if (pc !== this.pc) return;
      const st = pc.connectionState;
      if (st === 'connected') {
        this.update({ video: 'live' });
        this.applyBitrate();
        this.startStats();
      } else if (st === 'failed' || st === 'disconnected') {
        // Only the video retries; audio and the session keep going.
        this.update({ video: 'retrying' });
        if (this.videoRetryTimer) clearTimeout(this.videoRetryTimer);
        this.videoRetryTimer = setTimeout(() => {
          if (!this.stopped && this.pc === pc) this.syncVideoLink(true).catch(() => {});
        }, 3000);
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
    this.statsTimer = setInterval(async () => {
      const pc = this.pc;
      if (!pc) return;
      try {
        const report: any = await pc.getStats();
        let rtt: number | undefined;
        report.forEach((r: any) => {
          if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime != null) rtt = r.currentRoundTripTime * 1000;
        });
        this.update({ rttMs: rtt != null ? Math.round(rtt) : undefined });
      } catch {}
    }, 2000);
  }

  // ================= teardown / retry =================

  private linkLost(reason: string) {
    if (this.stopped) return;
    MicmeAudio?.stop();
    this.teardownLink();
    this.retries += 1;
    if (this.retries > MAX_RETRIES) {
      this.update({ status: 'error', error: reason });
      return;
    }
    this.update({ status: 'reconnecting', error: reason, audio: 'off', video: 'off' });
    const delay = Math.min(4000, 500 * this.retries);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private closePc() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
    }
    this.pc = null;
    this.videoSender = null;
  }

  private teardownLink() {
    this.closePc();
    if (this.ws) {
      this.ws.onmessage = this.ws.onclose = this.ws.onerror = null;
      try {
        this.ws.close();
      } catch {}
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
