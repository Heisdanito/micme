import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Transfer, TransferManager } from '../lib/transfers';
import { colors, radius, space } from '../theme';
import { Button } from './ui';

export function formatBytes(n = 0) {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB'];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${u[i]}`;
}

export function FilesPanel({
  transfers,
  manager,
  onSend,
  canSend,
}: {
  transfers: Transfer[];
  manager: TransferManager;
  onSend: () => void;
  canSend: boolean;
}) {
  return (
      <View style={styles.sheet}>
        <View style={styles.head}>
          <Text style={styles.title}>Files</Text>
          {transfers.some((t) => t.state !== 'active') && (
            <Pressable onPress={() => manager.clearFinished()} hitSlop={8}>
              <Text style={styles.clear}>Clear</Text>
            </Pressable>
          )}
        </View>
        <Text style={styles.sub}>Files you send land in Downloads/MicMe on the computer. Files from the computer appear here.</Text>
        <Button title="Send files to computer" icon="cloud-upload-outline" onPress={onSend} disabled={!canSend} />

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: space(2), paddingTop: space(2), paddingBottom: space(4) }}>
          {transfers.length === 0 && <Text style={styles.empty}>No transfers yet.</Text>}
          {transfers.map((t) => {
            const pct = t.size ? Math.min(100, Math.round((t.done / t.size) * 100)) : 0;
            return (
              <View key={t.id} style={styles.item}>
                <View style={[styles.dir, t.dir === 'in' ? styles.dirIn : styles.dirOut]}>
                  <Ionicons name={t.dir === 'in' ? 'arrow-down' : 'arrow-up'} size={16} color={t.dir === 'in' ? colors.success : colors.accent} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {t.name}
                  </Text>
                  {t.state === 'active' ? (
                    <View style={styles.bar}>
                      <View style={[styles.fill, { width: `${pct}%` }]} />
                    </View>
                  ) : (
                    <Text style={[styles.meta, t.state === 'failed' && { color: colors.danger }]} numberOfLines={1}>
                      {t.state === 'failed' ? t.error || 'Failed' : `${formatBytes(t.size)} · ${t.dir === 'in' ? 'received' : 'sent'}`}
                    </Text>
                  )}
                </View>
                {t.state === 'active' && <Text style={styles.meta}>{pct}%</Text>}
                {t.dir === 'in' && t.state === 'done' && (
                  <View style={styles.actions}>
                    {Platform.OS === 'android' && (
                      <Pressable onPress={() => manager.saveToFolder(t).catch(() => {})} style={styles.iconBtn} accessibilityLabel="Save to folder">
                        <Ionicons name="download-outline" size={18} color={colors.text} />
                      </Pressable>
                    )}
                    <Pressable onPress={() => manager.share(t).catch(() => {})} style={styles.iconBtn} accessibilityLabel="Share or open">
                      <Ionicons name="share-outline" size={18} color={colors.text} />
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, gap: space(3) },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  clear: { color: colors.muted, fontWeight: '600' },
  sub: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: space(6) },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  dir: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  dirIn: { backgroundColor: 'rgba(43,212,160,0.14)' },
  dirOut: { backgroundColor: colors.accentSoft },
  name: { color: colors.text, fontWeight: '600', fontSize: 14 },
  meta: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  bar: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent },
  actions: { flexDirection: 'row', gap: space(1) },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.border },
});
