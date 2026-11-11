import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { Tap } from '@/components/Tap';
import { useDataVersion } from '@/lib/dataEvents';
import { t } from '@/lib/i18n';
import { PERIODS, yearPeriod, type Period } from '@/lib/period';
import { getRecapYears } from '@/lib/recap';
import { makeStyles } from '@/lib/theme';

/** 7 giorni · 30 giorni · Quest'anno · Sempre · 2025 · 2024… (past years that have plays). */
export function PeriodChips({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const styles = useStyles();
  const version = useDataVersion();
  const [years, setYears] = useState<number[]>([]);

  useEffect(() => {
    const current = new Date().getFullYear();
    getRecapYears().then((ys) => setYears(ys.filter((y) => y < current)));
  }, [version]);

  const options = [
    ...PERIODS.map((p) => ({ key: p.key, label: t(p.label) })),
    ...years.map((y) => ({ key: yearPeriod(y), label: String(y) })),
  ];

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {options.map((p) => {
        const active = p.key === value;
        return (
          <Tap
            key={p.key}
            onPress={() => onChange(p.key)}
            style={[styles.chip, active && styles.chipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.text, active && styles.textActive]}>{p.label}</Text>
          </Tap>
        );
      })}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  row: { gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: colors.card },
  chipActive: { backgroundColor: colors.accent },
  text: { color: colors.muted, fontWeight: '600', fontSize: 13 },
  textActive: { color: colors.onAccent },
}));
