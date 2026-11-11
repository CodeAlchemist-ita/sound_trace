import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, SectionList, StyleSheet, Text, View } from 'react-native';

import { PlayItem } from '@/components/PlayItem';
import { useDataVersion } from '@/lib/dataEvents';
import { getRecentPlays, type PlayRow } from '@/lib/db';
import { locale, plural, t } from '@/lib/i18n';
import { openTrack } from '@/lib/nav';
import { contentColumn, makeStyles, useTheme } from '@/lib/theme';

const PAGE = 100;

export default function RecentScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const version = useDataVersion();
  const [plays, setPlays] = useState<PlayRow[]>([]);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const loaded = useRef(0);

  // New data (sync/import): reload what's already on screen, at least one page.
  useEffect(() => {
    let cancelled = false;
    const count = Math.max(PAGE, loaded.current);
    getRecentPlays(count, 0).then((rows) => {
      if (cancelled) return;
      loaded.current = rows.length;
      setPlays(rows);
      setDone(rows.length < count);
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const loadMore = useCallback(async () => {
    if (loading || done) return;
    setLoading(true);
    const rows = await getRecentPlays(PAGE, loaded.current);
    loaded.current += rows.length;
    setPlays((prev) => [...prev, ...rows]);
    setDone(rows.length < PAGE);
    setLoading(false);
  }, [loading, done]);

  const sections = useMemo(() => groupByDay(plays), [plays]);

  return (
    <SectionList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      sections={sections}
      keyExtractor={(p) => String(p.id)}
      renderItem={renderItem}
      renderSectionHeader={({ section }) => (
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{section.title}</Text>
          <Text style={styles.headerCount}>
            {plural(section.data.length, '{n} ascolto', '{n} ascolti')}
          </Text>
        </View>
      )}
      stickySectionHeadersEnabled
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      initialNumToRender={20}
      windowSize={9}
      ListEmptyComponent={<Text style={styles.empty}>{t('Nessun ascolto salvato per ora.')}</Text>}
      ListFooterComponent={loading ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} /> : undefined}
    />
  );
}

const renderItem = ({ item }: { item: PlayRow }) => <PlayItem play={item} onPress={openTrack} />;

function groupByDay(plays: PlayRow[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  const sections: { title: string; data: PlayRow[] }[] = [];
  let currentDay = -1;
  for (const p of plays) {
    const d = new Date(p.playedAt);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (day !== currentDay) {
      currentDay = day;
      const title =
        day === today
          ? t('Oggi')
          : day === yesterday
            ? t('Ieri')
            : d.toLocaleDateString(locale(), {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
              });
      sections.push({ title: title.charAt(0).toUpperCase() + title.slice(1), data: [] });
    }
    sections[sections.length - 1].data.push(p);
  }
  return sections;
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  content: { ...contentColumn, paddingHorizontal: 16, paddingBottom: 32 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    backgroundColor: colors.bg,
    paddingTop: 16,
    paddingBottom: 6,
  },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  headerCount: { color: colors.muted, fontSize: 12 },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 40 },
}));
