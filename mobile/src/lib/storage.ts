import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Pairing } from './pairing';
import type { Settings } from './session';

const LAST = 'micme.lastPairing';
const SETTINGS = 'micme.settings';

export const defaultSettings: Settings = {
  mic: true,
  cam: true,
  facing: 'back',
  quality: 'medium',
  voiceProcessing: true,
};

export async function loadLastPairing(): Promise<Pairing | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST);
    return raw ? (JSON.parse(raw) as Pairing) : null;
  } catch {
    return null;
  }
}

export async function saveLastPairing(p: Pairing) {
  try { await AsyncStorage.setItem(LAST, JSON.stringify(p)); } catch {}
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS);
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

export async function saveSettings(s: Settings) {
  try { await AsyncStorage.setItem(SETTINGS, JSON.stringify(s)); } catch {}
}
