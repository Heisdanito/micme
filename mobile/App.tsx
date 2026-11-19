import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { BackHandler, Linking, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { parsePairing, type Pairing } from './src/lib/pairing';
import type { Settings } from './src/lib/session';
import { defaultSettings, loadLastPairing, loadSettings, saveLastPairing, saveSettings } from './src/lib/storage';
import { HomeScreen } from './src/screens/HomeScreen';
import { ScanScreen } from './src/screens/ScanScreen';
import { StreamScreen } from './src/screens/StreamScreen';
import { colors } from './src/theme';

type Route = { name: 'home' } | { name: 'scan' } | { name: 'stream'; pairing: Pairing };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [last, setLast] = useState<Pairing | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);

  useEffect(() => {
    loadLastPairing().then(setLast);
    loadSettings().then(setSettings);

    // Phone camera apps can open micme:// links straight from the QR code.
    const open = (url?: string | null) => {
      const p = url ? parsePairing(url) : null;
      if (p) connect(p);
    };
    Linking.getInitialURL().then(open);
    const sub = Linking.addEventListener('url', (e) => open(e.url));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name === 'home') return false;
      setRoute({ name: 'home' });
      return true;
    });
    return () => sub.remove();
  }, [route.name]);

  const connect = (p: Pairing) => {
    setLast(p);
    saveLastPairing(p);
    setRoute({ name: 'stream', pairing: p });
  };

  const updateSettings = (s: Settings) => {
    setSettings(s);
    saveSettings(s);
  };

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style="light" />
        {route.name === 'home' && (
          <HomeScreen
            last={last}
            settings={settings}
            onSettings={updateSettings}
            onScan={() => setRoute({ name: 'scan' })}
            onConnect={connect}
          />
        )}
        {route.name === 'scan' && <ScanScreen onPaired={connect} onCancel={() => setRoute({ name: 'home' })} />}
        {route.name === 'stream' && (
          <StreamScreen
            pairing={route.pairing}
            settings={settings}
            onSettings={updateSettings}
            onExit={() => setRoute({ name: 'home' })}
          />
        )}
      </View>
    </SafeAreaProvider>
  );
}
