import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FilesSheet } from '../components/FilesSheet';
import { Button, RoundButton, StatusPill } from '../components/ui';
import type { Pairing } from '../lib/pairing';
import { MicMeSession, QUALITY, type Quality, type SessionSnapshot, type Settings } from '../lib/session';
import { TransferManager, type Transfer } from '../lib/transfers';
import { colors, radius, space } from '../theme';

const ORDER: Quality[] = ['low', 'medium', 'high'];
type RotateMode = 'auto' | 'portrait' | 'landscape';
const ROTATE_NEXT: Record<RotateMode, RotateMode> = { auto: 'portrait', portrait: 'landscape', landscape: 'auto' };
const ROTATE_LABEL: Record<RotateMode, string> = { auto: 'Auto-rotate', portrait: 'Portrait', landscape: 'Landscape' };

function linkLabel(host?: string) {
  if (!host) return '';
  if (host.startsWith('192.168.42.') || host.startsWith('192.168.137.')) return 'USB / PC hotspot';
  if (host.startsWith('172.20.10.') || host.startsWith('192.168.43.')) return 'Phone hotspot';
  return 'Local network';
}

function elapsed(since?: number) {
  if (!since) return '00:00';
  const s = Math.floor((Date.now() - since) / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function StreamScreen({
  pairing,
  settings,
  onSettings,
  onExit,
}: {
  pairing: Pairing;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onExit: () => void;
}) {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const session = useRef<MicMeSession | null>(null);
  const manager = useMemo(() => new TransferManager(), []);
  const [snap, setSnap] = useState<SessionSnapshot>({ status: 'connecting', settings, source: 'camera', computer: pairing.name });
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [filesOpen, setFilesOpen] = useState(false);
  const [rotate, setRotate] = useState<RotateMode>('auto');
  const [toast, setToast] = useState('');
  const [, tick] = useState(0);
  const pulse = useRef(new Animated.Value(0)).current;
  const lastTap = useRef(0);

  useEffect(() => manager.subscribe(setTransfers), [manager]);

  useEffect(() => {
    const s = new MicMeSession(pairing, settings, setSnap);
    session.current = s;
    s.onFileOffer = (files) => {
      const link = s.link;
      if (!link) return;
      setFilesOpen(true);
      manager.receive(link, files);
    };
    s.start();
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      clearInterval(t);
      s.stop();
      ScreenOrientation.unlockAsync().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing]);

  // Persist settings changed during the session (from either side).
  useEffect(() => {
    onSettings(snap.settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.settings]);

  useEffect(() => {
    const lock =
      rotate === 'portrait'
        ? ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
        : rotate === 'landscape'
          ? ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
          : ScreenOrientation.unlockAsync();
    lock.catch(() => {});
  }, [rotate]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const live = snap.status === 'live';
  const micOn = snap.settings.mic;
  const screen = snap.source === 'screen';

  useEffect(() => {
    if (!live || !micOn) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [live, micOn, pulse]);

  const s = session.current;
  const st = snap.settings;
  const statusLabel =
    snap.status === 'live'
      ? `Live · ${elapsed(snap.startedAt)}`
      : snap.status === 'negotiating'
        ? 'Starting'
        : snap.status === 'reconnecting'
          ? 'Reconnecting'
          : snap.status === 'closed'
            ? 'Stopped'
            : 'Connecting';
  const tone = live ? 'live' : 'busy';
  const activeTransfers = transfers.filter((t) => t.state === 'active').length;

  // Double-tap the preview to flip camera.
  const onStageTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      if (st.cam && !screen) {
        s?.flip();
        setToast(st.facing === 'front' ? 'Back camera' : 'Front camera');
      }
      lastTap.current = 0;
    } else lastTap.current = now;
  };

  const toggleScreen = async () => {
    try {
      await s?.setSource(screen ? 'camera' : 'screen');
    } catch {
      setToast('Screen sharing was not allowed');
    }
  };

  if (snap.status === 'error') {
    return (
      <View style={[styles.root, styles.center, { padding: space(6) }]}>
        <Ionicons name="cloud-offline-outline" size={54} color={colors.danger} />
        <Text style={styles.errTitle}>Couldn't connect</Text>
        <Text style={styles.errBody}>{snap.error}</Text>
        <Button title="Try again" icon="refresh" onPress={() => s?.start()} style={{ alignSelf: 'stretch', marginTop: space(6) }} />
        <Button title="Back" variant="ghost" onPress={onExit} style={{ alignSelf: 'stretch' }} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onStageTap} accessibilityHint="Double-tap to switch camera">
        {screen ? (
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            <View style={styles.micCore}>
              <Ionicons name="phone-portrait-outline" size={50} color="#fff" />
            </View>
            <Text style={styles.micText}>Sharing your screen with {snap.computer}</Text>
            <Text style={styles.micSub}>You can leave the app. Stop from here or the notification.</Text>
          </View>
        ) : st.cam && snap.previewUrl ? (
          <RTCView streamURL={snap.previewUrl} style={StyleSheet.absoluteFill} objectFit="cover" mirror={st.facing === 'front'} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            <View style={styles.micStage}>
              <Animated.View
                style={[
                  styles.ring,
                  {
                    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
                    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }],
                  },
                ]}
              />
              <View style={[styles.micCore, !micOn && { backgroundColor: colors.surface2 }]}>
                <Ionicons name={micOn ? 'mic' : 'mic-off'} size={54} color="#fff" />
              </View>
            </View>
            <Text style={styles.micText}>{micOn ? (live ? 'Your computer is hearing you' : 'Getting ready…') : 'Microphone muted'}</Text>
          </View>
        )}
      </Pressable>

      <View style={[styles.top, { paddingTop: insets.top + space(3), paddingLeft: insets.left + space(5), paddingRight: insets.right + space(5) }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.computer} numberOfLines={1}>
            {snap.computer}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {[linkLabel(snap.host), snap.host].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <StatusPill label={statusLabel} tone={tone} />
      </View>

      {!!toast && (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space(4), paddingLeft: insets.left + space(4), paddingRight: insets.right + space(4) }]}>
        {live && (
          <Text style={styles.stats}>
            {snap.rttMs != null ? `${snap.rttMs} ms` : '— ms'} · {snap.kbps != null ? `${snap.kbps} kbps` : '— kbps'}
            {screen ? ' · screen' : st.cam ? ` · ${QUALITY[st.quality].label}` : ' · audio only'}
          </Text>
        )}
        {snap.status === 'reconnecting' && !!snap.error && <Text style={styles.warn}>{snap.error}</Text>}

        <View style={styles.chips}>
          <MiniButton icon="camera-reverse-outline" label="Flip" disabled={!st.cam || screen} onPress={() => s?.flip()} />
          <MiniButton
            icon="options-outline"
            label={QUALITY[st.quality].label}
            disabled={screen}
            onPress={() => s?.setQuality(ORDER[(ORDER.indexOf(st.quality) + 1) % ORDER.length])}
          />
          <MiniButton icon={rotate === 'auto' ? 'sync-outline' : 'lock-closed-outline'} label={ROTATE_LABEL[rotate]} onPress={() => setRotate(ROTATE_NEXT[rotate])} />
        </View>

        <View style={styles.controls}>
          <RoundButton icon={micOn ? 'mic' : 'mic-off'} label={micOn ? 'Mute' : 'Unmute'} active={micOn} onPress={() => s?.setMic(!micOn)} />
          <RoundButton
            icon={st.cam ? 'videocam' : 'videocam-off'}
            label={st.cam ? 'Camera' : 'Cam off'}
            active={st.cam && !screen}
            onPress={() => !screen && s?.setCam(!st.cam)}
          />
          {MicMeSession.screenShareSupported && (
            <RoundButton icon={screen ? 'stop-circle-outline' : 'tv-outline'} label={screen ? 'Stop share' : 'Screen'} active={!screen} onPress={toggleScreen} />
          )}
          <View>
            <RoundButton icon="folder-open-outline" label="Files" onPress={() => setFilesOpen(true)} />
            {activeTransfers > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{activeTransfers}</Text>
              </View>
            )}
          </View>
          <RoundButton icon="stop" label="Stop" tone="danger" onPress={onExit} />
        </View>
      </View>

      <FilesSheet
        visible={filesOpen}
        onClose={() => setFilesOpen(false)}
        transfers={transfers}
        manager={manager}
        canSend={!!snap.link}
        onSend={() => snap.link && manager.pickAndSend(snap.link).catch(() => setToast('Could not open files'))}
      />
    </View>
  );
}

function MiniButton({ icon, label, onPress, disabled }: { icon: any; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.mini, { opacity: disabled ? 0.4 : pressed ? 0.75 : 1 }]}
    >
      <Ionicons name={icon} size={16} color={colors.text} />
      <Text style={styles.miniText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingBottom: space(4),
    backgroundColor: 'rgba(11,13,18,0.65)',
  },
  computer: { color: colors.text, fontSize: 18, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: space(4),
    backgroundColor: 'rgba(11,13,18,0.8)',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    gap: space(3),
  },
  chips: { flexDirection: 'row', justifyContent: 'center', gap: space(2) },
  mini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: space(3),
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  miniText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  controls: { flexDirection: 'row', justifyContent: 'space-evenly' },
  stats: { color: colors.muted, textAlign: 'center', fontSize: 13, fontVariant: ['tabular-nums'] },
  warn: { color: colors.warning, textAlign: 'center', fontSize: 13 },
  micStage: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 130, height: 130, borderRadius: 65, backgroundColor: colors.accent },
  micCore: { width: 130, height: 130, borderRadius: 65, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  micText: { color: colors.text, fontSize: 16, fontWeight: '600', marginTop: space(4), textAlign: 'center', paddingHorizontal: space(6) },
  micSub: { color: colors.muted, fontSize: 13, marginTop: space(2), textAlign: 'center', paddingHorizontal: space(8) },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    top: '42%',
    backgroundColor: 'rgba(11,13,18,0.85)',
    paddingHorizontal: space(4),
    paddingVertical: space(2),
    borderRadius: radius.pill,
  },
  toastText: { color: colors.text, fontWeight: '600' },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  errTitle: { color: colors.text, fontSize: 22, fontWeight: '700', marginTop: space(4) },
  errBody: { color: colors.muted, fontSize: 15, textAlign: 'center', marginTop: space(2), lineHeight: 21 },
});
