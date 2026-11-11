import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BarChart } from '@/components/BarChart';
import { Cover } from '@/components/Cover';
import { FadeIn } from '@/components/FadeIn';
import { PlayItem } from '@/components/PlayItem';
import { Tap } from '@/components/Tap';
import { TrackRow } from '@/components/TrackRow';
import { ensureArtistImages, ensureTrackCovers } from '@/lib/covers';
import { useDataVersion } from '@/lib/dataEvents';
import {
  getHourBuckets,
  getTrackUriFor,
  getItemSummary,
  getRecentPlays,
  getTrackStats,
  type ItemFilter,
  type ItemSummary,
  type PlayRow,
  type TrackStat,
} from '@/lib/db';
import { formatDate, formatDuration, formatNumber } from '@/lib/format';
import { friendsEnabled } from '@/lib/friends';
import { monthsShort, t } from '@/lib/i18n';
import { openAlbum, openArtist, openTrack } from '@/lib/nav';
import { contentColumn, makeStyles, radius, useTheme } from '@/lib/theme';
import { aggregate, lastMonths } from '@/lib/timeStats';

const HISTORY_PAGE = 30;

/** Detail of one song (artist + track), one album (artist + album) or one artist (artist). */
export default function DetailScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ artist: string; track?: string; album?: string }>();
  const artist = params.artist ?? '';
  const track = params.track;
  const album = params.album;
  const isTrack = track !== undefined;
  const isAlbum = !isTrack && album !== undefined;
  const version = useDataVersion();

  const [summary, setSummary] = useState<ItemSummary | null>(null);
  const [months, setMonths] = useState<ReturnType<typeof lastMonths>>([]);
  const [topTracks, setTopTracks] = useState<TrackStat[]>([]);
  const [history, setHistory] = useState<PlayRow[]>([]);
  const [historyDone, setHistoryDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const filter: ItemFilter = { artist, trackName: track, album: isAlbum ? album : undefined };
    const now = Date.now();
    Promise.all([
      getItemSummary(filter),
      getHourBuckets(0, now, filter),
      isTrack ? Promise.resolve([]) : getTrackStats(0, now, 'plays', { artist, album: isAlbum ? album : undefined, limit: isAlbum ? 50 : 10 }),
      getRecentPlays(HISTORY_PAGE, 0, filter),
    ]).then(([s, buckets, tops, plays]) => {
      if (cancelled) return;
      setSummary(s);
      // Imported plays have no artwork: look it up once (cached, '' = none on Spotify).
      if (!s.imageUrl && s.plays > 0 && !isAlbum) {
        const lookup = isTrack
          ? ensureTrackCovers([{ trackName: track, artist, imageUrl: null }]).then((m) => m.values().next().value)
          : ensureArtistImages([artist]).then((m) => m.get(artist.toLowerCase()));
        lookup
          .then((url) => {
            if (url && !cancelled) setSummary((cur) => (cur ? { ...cur, imageUrl: url } : cur));
          })
          .catch(console.warn);
      }
      setMonths(lastMonths(aggregate(buckets), 12));
      setTopTracks(tops);
      setHistory(plays);
      setHistoryDone(plays.length < HISTORY_PAGE);
    });
    return () => {
      cancelled = true;
    };
  }, [artist, track, album, isTrack, isAlbum, version]);

  const moreHistory = useCallback(async () => {
    const rows = await getRecentPlays(HISTORY_PAGE, history.length, {
      artist,
      trackName: track,
      album: isAlbum ? album : undefined,
    });
    setHistory((h) => [...h, ...rows]);
    setHistoryDone(rows.length < HISTORY_PAGE);
  }, [artist, track, album, isAlbum, history.length]);

  const title = isTrack ? track : isAlbum ? album : artist;

  async function onRecommend() {
    // The uri lets the friend open the exact song; imported plays may not have one.
    const uri = await getTrackUriFor(track ?? '', artist).catch(() => null);
    router.push({
      pathname: '/recommend',
      params: { track: track ?? '', artist, image: summary?.imageUrl ?? '', ...(uri ? { uri } : {}) },
    });
  }

  return (
    <>
      <Stack.Screen options={{ title: isTrack ? t('Brano') : isAlbum ? t('Album') : t('Artista') }} />
      {!summary ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
          <FadeIn style={styles.hero}>
            <Cover uri={summary.imageUrl} size={140} round={!isTrack && !isAlbum} />
            <Text style={styles.title}>{title}</Text>
            {(isTrack || isAlbum) && (
              <Tap onPress={() => openArtist({ artist })} hitSlop={6}>
                <Text style={styles.artistLink}>{artist} ›</Text>
              </Tap>
            )}
            {isTrack && friendsEnabled && (
              <Tap onPress={onRecommend} hitSlop={6} accessibilityRole="button" style={styles.recommend}>
                <Ionicons name="paper-plane-outline" size={16} color={colors.accent} />
                <Text style={styles.artistLink}>{t('Consiglia a un amico')}</Text>
              </Tap>
            )}
            {isTrack && summary.album && (
              <Tap onPress={() => summary.album && openAlbum({ album: summary.album, artist })} hitSlop={6}>
                <Text style={styles.album}>{summary.album} ›</Text>
              </Tap>
            )}
          </FadeIn>

          <View style={styles.tiles}>
            <Tile label={t('Ascolti')} value={formatNumber(summary.plays)} />
            <Tile label={t('Tempo totale')} value={formatDuration(summary.totalMs)} />
            {!isTrack && <Tile label={t('Brani diversi')} value={formatNumber(summary.uniqueTracks)} />}
            <Tile label={t('Primo ascolto')} value={summary.firstAt ? formatDate(summary.firstAt) : '—'} />
            <Tile label={t('Ultimo ascolto')} value={summary.lastAt ? formatDate(summary.lastAt) : '—'} />
            {isTrack && summary.plays > 0 && (
              <Tile label={t('Media per ascolto')} value={formatDuration(summary.totalMs / summary.plays)} />
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('Ascolti negli ultimi 12 mesi')}</Text>
            <BarChart values={months.map((m) => m.plays)} labels={months.map((m) => monthsShort()[m.month].charAt(0))} />
            <Text style={styles.note}>
              {months.length > 0 &&
                t('Da {month} {year} a oggi', { month: monthsShort()[months[0].month].toLowerCase(), year: months[0].year })}
            </Text>
          </View>

          {topTracks.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{isAlbum ? t('Brani dell’album') : t('Brani più ascoltati')}</Text>
              {topTracks.map((song, i) => (
                <TrackRow key={`${song.trackName}|${song.artist}`} rank={i + 1} track={song} onPress={openTrack} />
              ))}
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('Cronologia degli ascolti')}</Text>
            {history.length === 0 && <Text style={styles.note}>{t('Nessun ascolto.')}</Text>}
            {history.map((p) => (
              <PlayItem key={p.id} play={p} showDate onPress={isTrack ? undefined : openTrack} />
            ))}
            {!historyDone && (
              <Tap onPress={moreHistory} style={styles.more}>
                <Text style={styles.moreText}>{t('Mostra altri')}</Text>
              </Tap>
            )}
          </View>
        </ScrollView>
      )}
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  loading: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center' },
  content: { ...contentColumn, padding: 16, gap: 16, paddingBottom: 40 },
  hero: { alignItems: 'center', gap: 6, paddingVertical: 8 },
  title: { color: colors.text, fontSize: 26, fontWeight: '900', textAlign: 'center', marginTop: 10 },
  artistLink: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  album: { color: colors.muted, fontSize: 13 },
  recommend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: '45%', backgroundColor: colors.card, borderRadius: radius.md, padding: 14 },
  tileValue: { color: colors.text, fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tileLabel: { color: colors.muted, fontSize: 12, marginTop: 4 },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: 14, gap: 10 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  note: { color: colors.muted, fontSize: 12 },
  more: { alignItems: 'center', paddingVertical: 10 },
  moreText: { color: colors.accent, fontWeight: '700' },
}));
