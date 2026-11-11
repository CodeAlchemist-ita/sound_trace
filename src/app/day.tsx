import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { PlayItem } from '@/components/PlayItem';
import { useDataVersion } from '@/lib/dataEvents';
import { getPlaysInRange, minStreamMs, type PlayRow } from '@/lib/db';
import { formatDuration, formatLongDate } from '@/lib/format';
import { plural, t } from '@/lib/i18n';
import { openTrack } from '@/lib/nav';
import { contentColumn, makeStyles, useTheme } from '@/lib/theme';

/** Everything listened on one day (param: date = local midnight in ms). */
export default function DayScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { date } = useLocalSearchParams<{ date: string }>();
  const version = useDataVersion();
  const [plays, setPlays] = useState<PlayRow[]>([]);
  const start = Number(date);

  useEffect(() => {
    const d = new Date(start);
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1;
    getPlaysInRange(start, end).then(setPlays);
  }, [start, version]);

  const totals = useMemo(() => {
    let ms = 0;
    let streams = 0;
    for (const p of plays) {
      ms += p.msPlayed;
      if (p.source === 'api' || p.msPlayed >= minStreamMs()) streams++;
    }
    return { ms, streams };
  }, [plays]);

  const title = formatLongDate(start);

  return (
    <>
      <Stack.Screen options={{ title: t('Giorno') }} />
      <FlatList
        style={{ backgroundColor: colors.bg }}
        contentContainerStyle={styles.content}
        data={plays}
        keyExtractor={(p) => String(p.id)}
        renderItem={({ item }) => <PlayItem play={item} onPress={openTrack} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>{title.charAt(0).toUpperCase() + title.slice(1)}</Text>
            <Text style={styles.sub}>
              {t('{duration} di musica', { duration: formatDuration(totals.ms) })} ·{' '}
              {plural(totals.streams, '{n} ascolto', '{n} ascolti')}
            </Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>{t('Nessun ascolto in questo giorno.')}</Text>}
      />
    </>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  content: { ...contentColumn, paddingHorizontal: 16, paddingBottom: 32 },
  header: { paddingVertical: 16, gap: 4 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  sub: { color: colors.muted },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 32 },
}));
