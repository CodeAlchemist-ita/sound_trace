import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View, type ListRenderItemInfo } from 'react-native';

import { AlbumRow } from '@/components/AlbumRow';
import { ArtistRow } from '@/components/ArtistRow';
import { PeriodChips } from '@/components/PeriodChips';
import { Tap } from '@/components/Tap';
import { TrackRow } from '@/components/TrackRow';
import { fillMissingCovers } from '@/lib/covers';
import { notifyDataChanged, useDataVersion } from '@/lib/dataEvents';
import {
  getAlbumStats,
  getArtistStats,
  getTrackStats,
  type AlbumStat,
  type ArtistStat,
  type TrackSort,
  type TrackStat,
} from '@/lib/db';
import { plural, t } from '@/lib/i18n';
import { openAlbum, openArtist, openTrack } from '@/lib/nav';
import { periodPhrase, periodRange, type Period } from '@/lib/period';
import { contentColumn, makeStyles, radius, useTheme } from '@/lib/theme';

type Mode = 'tracks' | 'artists' | 'albums';
type Row =
  | { kind: 'track'; item: TrackStat }
  | { kind: 'artist'; item: ArtistStat }
  | { kind: 'album'; item: AlbumStat };

export default function TracksScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const version = useDataVersion();
  const [mode, setMode] = useState<Mode>('tracks');
  const [period, setPeriod] = useState<Period>('year');
  const [sort, setSort] = useState<TrackSort>('plays');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { from, to } = periodRange(period);
      const next: Row[] =
        mode === 'tracks'
          ? (await getTrackStats(from, to, sort, { search })).map((item) => ({ kind: 'track', item }))
          : mode === 'artists'
            ? (await getArtistStats(from, to, sort, { search })).map((item) => ({ kind: 'artist', item }))
            : (await getAlbumStats(from, to, sort, { search })).map((item) => ({ kind: 'album', item }));
      if (!cancelled) setRows(next);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [version, mode, period, sort, search]);

  // Imported years have no artwork: look it up for the period on screen (re-renders via notifyDataChanged).
  useEffect(() => {
    const { from, to } = periodRange(period);
    fillMissingCovers(from, to)
      .then((added) => added > 0 && notifyDataChanged())
      .catch(console.warn);
  }, [period]);

  const phrase = { period: periodPhrase(period) };
  const count =
    mode === 'tracks'
      ? plural(rows.length, '{n} brano {period}', '{n} brani {period}', phrase)
      : mode === 'artists'
        ? plural(rows.length, '{n} artista {period}', '{n} artisti {period}', phrase)
        : plural(rows.length, '{n} album {period}', '{n} album {period}', phrase);

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      data={rows}
      keyExtractor={keyOf}
      renderItem={renderItem}
      initialNumToRender={15}
      windowSize={7}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.segment}>
            <SegmentButton label={t('Brani')} active={mode === 'tracks'} onPress={() => setMode('tracks')} />
            <SegmentButton label={t('Artisti')} active={mode === 'artists'} onPress={() => setMode('artists')} />
            <SegmentButton label={t('Album')} active={mode === 'albums'} onPress={() => setMode('albums')} />
          </View>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={
              mode === 'tracks'
                ? t('Cerca canzone, artista o album')
                : mode === 'artists'
                  ? t('Cerca artista')
                  : t('Cerca album o artista')
            }
            placeholderTextColor={colors.muted}
            style={styles.search}
            clearButtonMode="while-editing"
          />
          <PeriodChips value={period} onChange={setPeriod} />
          <View style={styles.sortRow}>
            <Text style={styles.count}>{count}</Text>
            <View style={styles.sortSwitch}>
              <SortButton label={t('Ascolti')} active={sort === 'plays'} onPress={() => setSort('plays')} />
              <SortButton label={t('Minuti')} active={sort === 'time'} onPress={() => setSort('time')} />
            </View>
          </View>
        </View>
      }
      ListEmptyComponent={<Text style={styles.empty}>{t('Nessun risultato.')}</Text>}
    />
  );
}

// Defined outside the component so FlatList gets stable references.
const keyOf = (r: Row) =>
  r.kind === 'track'
    ? `t|${r.item.trackName}|${r.item.artist}`
    : r.kind === 'artist'
      ? `a|${r.item.artist}`
      : `l|${r.item.album}|${r.item.artist}`;
const renderItem = ({ item, index }: ListRenderItemInfo<Row>) =>
  item.kind === 'track' ? (
    <TrackRow rank={index + 1} track={item.item} onPress={openTrack} />
  ) : item.kind === 'artist' ? (
    <ArtistRow rank={index + 1} artist={item.item} onPress={openArtist} />
  ) : (
    <AlbumRow rank={index + 1} album={item.item} onPress={openAlbum} />
  );

function SegmentButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Tap
      onPress={onPress}
      style={[styles.segBtn, active && styles.segBtnActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.segText, active && styles.segTextActive]}>{label}</Text>
    </Tap>
  );
}

function SortButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Tap onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: active }}>
      <Text style={[styles.sortText, active && styles.sortTextActive]}>{label}</Text>
    </Tap>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  content: { ...contentColumn, paddingHorizontal: 16, paddingBottom: 32 },
  header: { gap: 12, paddingTop: 8, paddingBottom: 8 },
  search: {
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  segment: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 999, padding: 4 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: 'center' },
  segBtnActive: { backgroundColor: colors.cardAlt },
  segText: { color: colors.muted, fontWeight: '600' },
  segTextActive: { color: colors.text },
  sortRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sortSwitch: { flexDirection: 'row', gap: 14 },
  sortText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  sortTextActive: { color: colors.accent },
  count: { color: colors.muted, fontSize: 12, flexShrink: 1 },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 32 },
}));
