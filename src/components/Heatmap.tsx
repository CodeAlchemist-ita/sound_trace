import { useMemo, useRef } from 'react';
import { Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, View } from 'react-native';

import { monthsShort, weekdayPosition } from '@/lib/i18n';
import { useSettings } from '@/lib/settings';
import { makeStyles, useTheme } from '@/lib/theme';

const CELL = 13;
const GAP = 3;

/**
 * One square per day of `year` (columns = weeks, rows = the days of the week starting
 * from the one chosen in Settings), darker the more you listened.
 * `days`: local midnight → ms listened.
 */
export function Heatmap({
  year,
  days,
  onPressDay,
}: {
  year: number;
  days: Map<number, { ms: number }>;
  onPressDay: (date: number) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const scroll = useRef<ScrollViewInstance>(null);
  const { weekStart } = useSettings();

  const { weeks, max } = useMemo(() => {
    const jan1 = new Date(year, 0, 1);
    const start = new Date(year, 0, 1 - weekdayPosition(jan1.getDay())); // first day of the week on/before Jan 1st
    const today = new Date();
    const last = year === today.getFullYear() ? today : new Date(year, 11, 31);
    const out: { date: number; inYear: boolean; ms: number }[][] = [];
    let maxMs = 0;
    for (let d = new Date(start); d <= last; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      if (weekdayPosition(d.getDay()) === 0) out.push([]);
      const date = d.getTime();
      const ms = days.get(date)?.ms ?? 0;
      maxMs = Math.max(maxMs, ms);
      out[out.length - 1].push({ date, inYear: d.getFullYear() === year, ms });
    }
    return { weeks: out, max: maxMs };
    // weekStart: weekdayPosition() reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, days, weekStart]);

  return (
    <ScrollView
      ref={scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      // Current year: start from the most recent weeks.
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
    >
      <View>
        <View style={styles.months}>
          {weeks.map((w, i) => {
            // Label a week with its month when that month starts in it (by the week's last day).
            const month = new Date(w[w.length - 1].date).getMonth();
            const prevMonth = i > 0 ? new Date(weeks[i - 1][weeks[i - 1].length - 1].date).getMonth() : -1;
            return (
              <Text key={i} style={[styles.month, { width: CELL + GAP }]} numberOfLines={1}>
                {month !== prevMonth && w.some((d) => d.inYear) ? monthsShort()[month] : ''}
              </Text>
            );
          })}
        </View>
        <View style={styles.grid}>
          {weeks.map((w, i) => (
            <View key={i} style={styles.week}>
              {w.map((d) => (
                <Pressable
                  key={d.date}
                  disabled={!d.inYear || d.ms === 0}
                  onPress={() => onPressDay(d.date)}
                  style={[
                    styles.cell,
                    {
                      backgroundColor: !d.inYear
                        ? 'transparent'
                        : d.ms === 0
                          ? colors.cardAlt
                          : colors.heat[Math.min(3, Math.floor((d.ms / max) * 4))],
                    },
                  ]}
                />
              ))}
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  months: { flexDirection: 'row', marginBottom: 4 },
  month: { color: colors.muted, fontSize: 10, overflow: 'visible' },
  grid: { flexDirection: 'row', gap: GAP },
  week: { gap: GAP },
  cell: { width: CELL, height: CELL, borderRadius: 3 },
}));
