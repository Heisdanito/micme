import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FilesPanel } from '../components/FilesPanel';
import { Button, Chip, StatusPill } from '../components/ui';
import type { Pairing } from '../lib/pairing';
import { MicMeSession, QUALITY, type Quality, type SessionSnapshot, type Settings } from '../lib/session';
import { TransferManager, type Transfer } from '../lib/transfers';
import { colors, radius, space } from '../theme';

type Tab = 'audio' | 'camera' | 'screen' | 'files';
type IconName = ComponentProps<typeof Ionicons>['name'];
type RotateMode = 'auto' | 'portrait' | 'landscape';

const TABS: { id: Tab; label: string; icon: IconName; iconOn: IconName }[] = [
  { id: 'audio', label: 'Audio', icon: 'mic-outline', iconOn: 'mic' },
  { id: 'camera', label: 'Camera', icon: 'videocam-outline', iconOn: 'videocam' },
  { id: 'screen', label: 'Screen', icon: 'phone-portrait-outline', iconOn: 'phone-portrait' },
  { id: 'files', label: 'Files', icon: 'folder-outline', iconOn: 'folder' },
];
const ROTATE_NEXT: Record<RotateMode, RotateMode> = { auto: 'portrait', portrait: 'landscape', landscape: 'auto' };
const ROTATE_LABEL: Record<RotateMode, string> = { auto: 'Auto-rotate', portrait: 'Portrait', landscape: 'Landscape' };

function linkLabel(host?: string) {
  if (!host) return '';
  if (host === '127.0.0.1') return 'USB cable';
  if (host.startsWith('192.168.42.')) return 'USB tethering';
  if (host.startsWith('192.168.137.')) return 'PC hotspot';
  return 'Wi-Fi / hotspot';
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
  const [snap, setSnap] = useState<SessionSnapshot>({
    status: 'connecting',
    settings,
    source: 'camera',
    audio: 'off',
    level: 0,
    video: 'off',
    computer: pairing.name,
  });
  const [tab, setTab] = useState<Tab>('audio');
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [rotate, setRotate] = useState<RotateMode>('auto');
  const [toast, setToast] = useState('');
  const [, tick] = useState(0);
  const lastTap = useRef(0);

  useEffect(() => manager.subscribe(setTransfers), [manager]);

  useEffect(() => {
    const s = new MicMeSession(pairing, settings, setSnap);
    session.current = s;
    s.onFileOffer = (files) => {
      const link = s.link;
      if (!link) return;
      setTab('files');
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

  useEffect(() => {
    onSettings(snap.settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.settings]);

  useEffect(() => {
    const p =
      rotate === 'portrait'
        ? ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
        : rotate === 'landscape'
          ? ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
          : ScreenOrientation.unlockAsync();
    p.catch(() => {});
  }, [rotate]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const s = session.current;
  const st = snap.settings;
  const screen = snap.source === 'screen';
  const streaming = snap.audio === 'streaming';
  const activeTransfers = transfers.filter((t) => t.state === 'active').length;

  const pill =
    snap.status === 'connected'
      ? { label: streaming ? `Live · ${elapsed(snap.startedAt)}` : 'Connected', tone: streaming ? ('live' as const) : ('busy' as const) }
      : snap.status === 'reconnecting'
        ? { label: 'Reconnecting', tone: 'busy' as const }
        : { label: 'Connecting', tone: 'busy' as const };

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

  const onPreviewTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      s?.flip();
      setToast(st.facing === 'front' ? 'Back camera' : 'Front camera');
      lastTap.current = 0;
    } else lastTap.current = now;
  };

  return (
    <View style={styles.root}>
      {/* header */}
      <View style={[styles.header, { paddingTop: insets.top + space(3), paddingLeft: insets.left + space(5), paddingRight: insets.right + space(4) }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.computer} numberOfLines={1}>
            {snap.computer}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {snap.status === 'reconnecting' ? snap.error || 'Reconnecting…' : linkLabel(snap.host)}
          </Text>
        </View>
        <StatusPill label={pill.label} tone={pill.tone} />
        <Pressable onPress={onExit} style={styles.close} accessibilityLabel="Disconnect" hitSlop={8}>
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>
      </View>

      {/* content */}
      <View style={[styles.body, { paddingLeft: insets.left + space(5), paddingRight: insets.right + space(5) }]}>
        {tab === 'audio' && (
          <ScrollView contentContainerStyle={styles.tabContent}>
            <View style={styles.audioStage}>
              <View
                style={[
                  styles.levelRing,
                  { transform: [{ scale: 1 + Math.min(1, snap.level * 2.2) * 0.45 }], opacity: st.mic && streaming ? 0.35 : 0 },
                ]}
              />
              <Pressable
                onPress={() => s?.setMic(!st.mic)}
                style={[styles.micCore, !st.mic && { backgroundColor: colors.surface2 }]}
                accessibilityLabel={st.mic ? 'Mute microphone' : 'Unmute microphone'}
              >
                <Ionicons name={st.mic ? 'mic' : 'mic-off'} size={58} color="#fff" />
              </Pressable>
            </View>
            <Text style={styles.bigTitle}>
              {!st.mic ? 'Muted' : streaming ? 'Your PC is hearing you' : snap.audio === 'error' ? 'Microphone problem' : 'Connecting audio…'}
            </Text>
            <Text style={styles.bigSub}>
              {snap.audio === 'error'
                ? snap.audioError
                : snap.audio === 'retrying'
                  ? `Reconnecting audio${snap.audioError ? `: ${snap.audioError}` : '…'}`
                  : st.mic
                    ? 'Tap the mic to mute.'
                    : 'Tap the mic to unmute.'}
            </Text>

            <View style={styles.card}>
              <Row icon="sparkles-outline" title="Clean voice" hint="Noise suppression, echo cancel, auto gain">
                <Switch
                  value={st.voiceProcessing}
                  onValueChange={(v) => s?.setVoiceProcessing(v)}
                  trackColor={{ true: colors.accent, false: colors.border }}
                  thumbColor="#fff"
                />
              </Row>
            </View>
          </ScrollView>
        )}

        {tab === 'camera' && (
          <View style={[styles.tabContent, { flex: 1 }]}>
            <Pressable style={styles.preview} onPress={onPreviewTap} accessibilityHint="Double-tap to switch camera">
              {screen ? (
                <Empty icon="phone-portrait-outline" text="The phone is sharing its screen. Stop screen sharing to use the camera." />
              ) : st.cam && snap.previewUrl ? (
                <RTCView streamURL={snap.previewUrl} style={StyleSheet.absoluteFill} objectFit="cover" mirror={st.facing === 'front'} />
              ) : (
                <Empty icon="videocam-off-outline" text="Camera is off" />
              )}
              {st.cam && !screen && (
                <View style={styles.previewTag}>
                  <Text style={styles.previewTagText}>
                    {snap.video === 'live' ? `On PC · ${snap.rttMs ?? '—'} ms` : snap.video === 'retrying' ? 'Reconnecting video…' : 'Connecting video…'}
                  </Text>
                </View>
              )}
            </Pressable>
            <View style={styles.controlRow}>
              <Button
                title={st.cam ? 'Camera off' : 'Camera on'}
                icon={st.cam ? 'videocam-off-outline' : 'videocam-outline'}
                variant={st.cam ? 'secondary' : 'primary'}
                disabled={screen}
                onPress={() => s?.setCam(!st.cam)}
                style={{ flex: 1 }}
              />
              <Button title="Flip" icon="camera-reverse-outline" variant="secondary" disabled={!st.cam || screen} onPress={() => s?.flip()} />
            </View>
            <View style={styles.chipsRow}>
              {(Object.keys(QUALITY) as Quality[]).map((q) => (
                <Chip key={q} label={QUALITY[q].label} selected={st.quality === q} onPress={() => s?.setQuality(q)} />
              ))}
              <Chip label={ROTATE_LABEL[rotate]} selected={rotate !== 'auto'} onPress={() => setRotate(ROTATE_NEXT[rotate])} />
            </View>
          </View>
        )}

        {tab === 'screen' && (
          <ScrollView contentContainerStyle={styles.tabContent}>
            <View style={styles.screenHero}>
              <Ionicons name={screen ? 'radio-button-on' : 'phone-portrait-outline'} size={56} color={screen ? colors.danger : colors.accent} />
            </View>
            <Text style={styles.bigTitle}>{screen ? 'Sharing your screen' : 'Share your screen'}</Text>
            <Text style={styles.bigSub}>
              {MicMeSession.screenShareSupported
                ? screen
                  ? snap.video === 'live'
                    ? 'Your PC can see your screen. You can switch to other apps.'
                    : 'Connecting video…'
                  : 'Show your phone’s screen on the PC. Android will ask you to allow it.'
                : 'Screen sharing is available on Android.'}
            </Text>
            {MicMeSession.screenShareSupported && (
              <Button
                title={screen ? 'Stop sharing' : 'Start sharing'}
                icon={screen ? 'stop-circle-outline' : 'play-circle-outline'}
                variant={screen ? 'danger' : 'primary'}
                onPress={() => s?.setSource(screen ? 'camera' : 'screen').catch(() => setToast('Screen sharing was not allowed'))}
                style={{ alignSelf: 'stretch', marginTop: space(4) }}
              />
            )}
          </ScrollView>
        )}

        {tab === 'files' && (
          <View style={[styles.tabContent, { flex: 1 }]}>
            <FilesPanel
              transfers={transfers}
              manager={manager}
              canSend={!!snap.link}
              onSend={() => snap.link && manager.pickAndSend(snap.link).catch(() => setToast('Could not open files'))}
            />
          </View>
        )}
      </View>

      {!!toast && (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {/* tab bar */}
      <View style={[styles.tabBar, { paddingBottom: insets.bottom + space(2), paddingLeft: insets.left, paddingRight: insets.right }]}>
        {TABS.map((t) => {
          const active = tab === t.id;
          const on =
            (t.id === 'audio' && streaming && st.mic) ||
            (t.id === 'camera' && st.cam && !screen) ||
            (t.id === 'screen' && screen) ||
            (t.id === 'files' && activeTransfers > 0);
          return (
            <Pressable key={t.id} style={styles.tabItem} onPress={() => setTab(t.id)} accessibilityRole="tab" accessibilityState={{ selected: active }}>
              <View style={[styles.tabIcon, active && styles.tabIconActive]}>
                <Ionicons name={active ? t.iconOn : t.icon} size={22} color={active ? colors.text : colors.muted} />
                {on && <View style={styles.tabDot} />}
              </View>
              <Text style={[styles.tabLabel, active && { color: colors.text }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Row({ icon, title, hint, children }: { icon: IconName; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={22} color={colors.muted} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {hint && <Text style={styles.rowHint}>{hint}</Text>}
      </View>
      {children}
    </View>
  );
}

function Empty({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.center, { padding: space(6), gap: space(3) }]}>
      <Ionicons name={icon} size={44} color={colors.muted} />
      <Text style={[styles.bigSub, { marginTop: 0 }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingBottom: space(3) },
  computer: { color: colors.text, fontSize: 18, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  close: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  body: { flex: 1 },
  tabContent: { paddingTop: space(4), paddingBottom: space(4), gap: space(3) },
  audioStage: { alignSelf: 'center', width: 230, height: 230, alignItems: 'center', justifyContent: 'center', marginTop: space(4) },
  levelRing: { position: 'absolute', width: 150, height: 150, borderRadius: 75, backgroundColor: colors.accent },
  micCore: { width: 150, height: 150, borderRadius: 75, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  bigTitle: { color: colors.text, fontSize: 22, fontWeight: '700', textAlign: 'center', marginTop: space(2) },
  bigSub: { color: colors.muted, fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: space(4) },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space(4), marginTop: space(4) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowHint: { color: colors.muted, fontSize: 12.5 },
  preview: { flex: 1, minHeight: 240, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1, borderColor: colors.border },
  previewTag: {
    position: 'absolute',
    top: space(3),
    left: space(3),
    backgroundColor: 'rgba(11,13,18,0.75)',
    borderRadius: radius.pill,
    paddingHorizontal: space(3),
    paddingVertical: 5,
  },
  previewTagText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  controlRow: { flexDirection: 'row', gap: space(2) },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  screenHero: {
    alignSelf: 'center',
    width: 120,
    height: 120,
    borderRadius: 36,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space(10),
  },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    top: '45%',
    backgroundColor: 'rgba(11,13,18,0.9)',
    paddingHorizontal: space(4),
    paddingVertical: space(2),
    borderRadius: radius.pill,
  },
  toastText: { color: colors.text, fontWeight: '600' },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, paddingTop: space(2) },
  tabItem: { flex: 1, alignItems: 'center', gap: 4 },
  tabIcon: { width: 56, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  tabIconActive: { backgroundColor: colors.accentSoft },
  tabDot: { position: 'absolute', top: 3, right: 12, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  tabLabel: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  errTitle: { color: colors.text, fontSize: 22, fontWeight: '700', marginTop: space(4) },
  errBody: { color: colors.muted, fontSize: 15, textAlign: 'center', marginTop: space(2), lineHeight: 21 },
});
