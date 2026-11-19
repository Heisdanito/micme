import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Chip } from '../components/ui';
import { manualPairing, type Pairing } from '../lib/pairing';
import { QUALITY, type Quality, type Settings } from '../lib/session';
import { colors, radius, space } from '../theme';

export function HomeScreen({
  last,
  settings,
  onSettings,
  onScan,
  onConnect,
}: {
  last: Pairing | null;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onScan: () => void;
  onConnect: (p: Pairing) => void;
}) {
  const insets = useSafeAreaInsets();
  const [manual, setManual] = useState(false);
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const submitManual = () => {
    const p = manualPairing(address, code);
    if (!p) {
      setError('Enter the IP shown on the computer (e.g. 192.168.43.20) and the 6-character code.');
      return;
    }
    setError('');
    onConnect(p);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={{ padding: space(5), paddingTop: insets.top + space(6), paddingBottom: insets.bottom + space(8), gap: space(4) }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Ionicons name="mic" size={28} color="#fff" />
          </View>
          <View>
            <Text style={styles.title}>MicMe</Text>
            <Text style={styles.subtitle}>Your phone as a mic and camera for your computer</Text>
          </View>
        </View>

        <Button title="Scan QR code" icon="qr-code-outline" onPress={onScan} />

        {last && (
          <Card style={styles.row}>
            <Ionicons name="desktop-outline" size={22} color={colors.muted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{last.name}</Text>
              <Text style={styles.muted}>{last.hosts[0]}:{last.port}</Text>
            </View>
            <Button title="Reconnect" variant="secondary" onPress={() => onConnect(last)} style={{ height: 42 }} />
          </Card>
        )}

        <Card style={{ gap: space(4) }}>
          <Text style={styles.section}>Stream</Text>
          <Toggle label="Microphone" icon="mic-outline" value={settings.mic} onChange={(mic) => onSettings({ ...settings, mic })} />
          <Toggle label="Camera" icon="videocam-outline" value={settings.cam} onChange={(cam) => onSettings({ ...settings, cam })} />
          <Toggle
            label="Voice cleanup"
            hint="Noise suppression, echo cancel, auto gain"
            icon="sparkles-outline"
            value={settings.voiceProcessing}
            onChange={(voiceProcessing) => onSettings({ ...settings, voiceProcessing })}
          />
          <View style={{ gap: space(2) }}>
            <Text style={styles.muted}>Video quality</Text>
            <View style={styles.chips}>
              {(Object.keys(QUALITY) as Quality[]).map((q) => (
                <Chip key={q} label={QUALITY[q].label} selected={settings.quality === q} onPress={() => onSettings({ ...settings, quality: q })} />
              ))}
            </View>
          </View>
          <View style={{ gap: space(2) }}>
            <Text style={styles.muted}>Camera</Text>
            <View style={styles.chips}>
              <Chip label="Back" selected={settings.facing === 'back'} onPress={() => onSettings({ ...settings, facing: 'back' })} />
              <Chip label="Front" selected={settings.facing === 'front'} onPress={() => onSettings({ ...settings, facing: 'front' })} />
            </View>
          </View>
        </Card>

        <Card style={{ gap: space(3) }}>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={styles.section}>Enter code manually</Text>
            <Switch value={manual} onValueChange={setManual} trackColor={{ true: colors.accent, false: colors.border }} thumbColor="#fff" />
          </View>
          {manual && (
            <>
              <TextInput
                style={styles.input}
                placeholder="Computer IP (e.g. 192.168.43.20)"
                placeholderTextColor={colors.muted}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
                value={address}
                onChangeText={setAddress}
              />
              <TextInput
                style={[styles.input, styles.code]}
                placeholder="CODE"
                placeholderTextColor={colors.muted}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={6}
                value={code}
                onChangeText={setCode}
              />
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Button title="Connect" variant="secondary" icon="link-outline" onPress={submitManual} />
            </>
          )}
        </Card>

        <Card style={{ gap: space(3) }}>
          <Text style={styles.section}>How to connect</Text>
          <Step n={1} text="Open MicMe on your computer." />
          <Step n={2} text="Hotspot: turn on your phone's hotspot and join it from the computer (or join the computer's hotspot)." />
          <Step n={3} text="USB: plug in the cable and turn on USB tethering (Android) or Personal Hotspot (iPhone)." />
          <Step n={4} text="Scan the QR code. MicMe picks the fastest link on its own." />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Toggle({
  label,
  hint,
  icon,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  icon: any;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={22} color={colors.muted} />
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{label}</Text>
        {hint && <Text style={styles.muted}>{hint}</Text>}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent, false: colors.border }} thumbColor="#fff" />
    </View>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={[styles.row, { alignItems: 'flex-start' }]}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
      <Text style={[styles.muted, { flex: 1, fontSize: 14, lineHeight: 20 }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space(4), marginBottom: space(4) },
  logo: { width: 56, height: 56, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 28, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 2, maxWidth: 260 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  section: { color: colors.text, fontSize: 16, fontWeight: '700' },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: 13 },
  chips: { flexDirection: 'row', gap: space(2), flexWrap: 'wrap' },
  input: {
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    color: colors.text,
    paddingHorizontal: space(4),
    fontSize: 16,
  },
  code: { letterSpacing: 6, fontWeight: '700', textAlign: 'center', fontSize: 20 },
  error: { color: colors.danger, fontSize: 13 },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
});
