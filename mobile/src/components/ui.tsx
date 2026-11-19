import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { colors, radius, space } from '../theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export function Button({
  title,
  icon,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  style,
}: {
  title: string;
  icon?: IconName;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const bg =
    variant === 'primary' ? colors.accent : variant === 'danger' ? colors.danger : variant === 'secondary' ? colors.surface2 : 'transparent';
  const fg = variant === 'secondary' || variant === 'ghost' ? colors.text : '#fff';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        variant === 'secondary' && styles.btnBorder,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={20} color={fg} /> : null}
      <Text style={[styles.btnText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function RoundButton({
  icon,
  label,
  onPress,
  active = true,
  tone = 'default',
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  tone?: 'default' | 'danger';
}) {
  const bg = tone === 'danger' ? colors.danger : active ? colors.surface2 : colors.text;
  const fg = tone === 'danger' ? '#fff' : active ? colors.text : colors.bg;
  return (
    <View style={styles.roundWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => [styles.round, { backgroundColor: bg, transform: [{ scale: pressed ? 0.94 : 1 }] }]}
      >
        <Ionicons name={icon} size={26} color={fg} />
      </Pressable>
      <Text style={styles.roundLabel}>{label}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}
    >
      <Text style={[styles.chipText, selected && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export function StatusPill({ label, tone }: { label: string; tone: 'live' | 'busy' | 'error' | 'idle' }) {
  const c = tone === 'live' ? colors.success : tone === 'busy' ? colors.warning : tone === 'error' ? colors.danger : colors.muted;
  return (
    <View style={[styles.pill, { borderColor: c }]}>
      <View style={[styles.dot, { backgroundColor: c }]} />
      <Text style={[styles.pillText, { color: c }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 54,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(2),
    paddingHorizontal: space(5),
  },
  btnBorder: { borderWidth: 1, borderColor: colors.border },
  btnText: { fontSize: 16, fontWeight: '600' },
  roundWrap: { alignItems: 'center', gap: space(2) },
  round: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center' },
  roundLabel: { color: colors.muted, fontSize: 12, fontWeight: '500' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(5),
  },
  chip: {
    paddingHorizontal: space(4),
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { color: colors.muted, fontWeight: '600', fontSize: 14 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    height: 28,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontSize: 13, fontWeight: '600' },
});
