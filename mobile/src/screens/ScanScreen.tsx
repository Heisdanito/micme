import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/ui';
import { parsePairing, type Pairing } from '../lib/pairing';
import { colors, radius, space } from '../theme';

export function ScanScreen({ onPaired, onCancel }: { onPaired: (p: Pairing) => void; onCancel: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [hint, setHint] = useState('Point at the QR code in MicMe on your computer');
  const done = useRef(false);
  const insets = useSafeAreaInsets();

  if (!permission) return <View style={styles.root} />;

  if (!permission.granted) {
    return (
      <View style={[styles.root, styles.center, { padding: space(6) }]}>
        <Ionicons name="camera-outline" size={48} color={colors.muted} />
        <Text style={styles.title}>Camera access needed</Text>
        <Text style={styles.body}>MicMe needs the camera to scan the pairing code.</Text>
        <Button title="Allow camera" onPress={requestPermission} style={{ alignSelf: 'stretch', marginTop: space(6) }} />
        <Button title="Back" variant="ghost" onPress={onCancel} style={{ alignSelf: 'stretch' }} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (done.current) return;
          const p = parsePairing(data);
          if (p) {
            done.current = true;
            onPaired(p);
          } else {
            setHint("That isn't a MicMe code. Scan the one shown in the desktop app.");
          }
        }}
      />
      <View style={[styles.overlay, { paddingTop: insets.top + space(4), paddingBottom: insets.bottom + space(8) }]}>
        <Pressable onPress={onCancel} accessibilityLabel="Close scanner" style={styles.close}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        <View style={styles.frame} />
        <Text style={styles.hint}>{hint}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, gap: space(2) },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', marginTop: space(3) },
  body: { color: colors.muted, fontSize: 15, textAlign: 'center' },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'space-between' },
  close: {
    alignSelf: 'flex-start',
    marginLeft: space(4),
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: { width: 260, height: 260, borderRadius: radius.lg, borderWidth: 3, borderColor: colors.accent },
  hint: {
    color: '#fff',
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: space(5),
    paddingVertical: space(3),
    marginHorizontal: space(6),
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.55)',
    overflow: 'hidden',
  },
});
