import { requireOptionalNativeModule, type EventSubscription } from 'expo';

export type AudioState = 'connecting' | 'streaming' | 'retrying' | 'stopped' | 'error';

type Native = {
  start(url: string, voiceProcessing: boolean): void;
  stop(): void;
  setMuted(muted: boolean): void;
  setVoiceProcessing(on: boolean): void;
  addListener(event: 'onState', fn: (e: { state: AudioState; message?: string | null }) => void): EventSubscription;
  addListener(event: 'onLevel', fn: (e: { level: number }) => void): EventSubscription;
};

/**
 * Native mic → PC pipe (Android): AudioRecord 48 kHz mono PCM16 in 20 ms
 * frames, sent as binary WebSocket messages straight from Kotlin. The same
 * idea as MicStream / WO Mic: no WebRTC, so it works over phone hotspot,
 * USB tethering, `adb reverse` (plain USB) and Wi-Fi.
 */
const MicmeAudio = requireOptionalNativeModule<Native>('MicmeAudio');
export default MicmeAudio;
