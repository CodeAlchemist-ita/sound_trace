import { StyleSheet, Text, View } from 'react-native';

import { makeStyles, useTheme } from '@/lib/theme';

/** Minimal bar chart: one bar per value, the highest (or `highlight`) in accent color. */
export function BarChart({
  values,
  labels,
  highlight,
  height = 120,
}: {
  values: number[];
  labels: string[];
  highlight?: number;
  height?: number;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const max = Math.max(...values, 1);
  const hi = highlight ?? values.indexOf(Math.max(...values));
  return (
    <View style={[styles.bars, { height }]}>
      {values.map((v, i) => (
        <View key={i} style={styles.col}>
          <View style={styles.track}>
            <View
              style={{
                height: `${v > 0 ? Math.max(3, (v / max) * 100) : 0}%`,
                backgroundColor: i === hi && v > 0 ? colors.accent : colors.border,
                borderRadius: 3,
              }}
            />
          </View>
          <Text style={styles.label} numberOfLines={1}>
            {labels[i]}
          </Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  col: { flex: 1, height: '100%', alignItems: 'center', gap: 4 },
  track: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  label: { color: colors.muted, fontSize: 10, fontWeight: '600' },
}));
