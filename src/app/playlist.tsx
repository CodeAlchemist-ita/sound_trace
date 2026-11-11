import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BarChart } from '@/components/BarChart';
import { Cover } from '@/components/Cover';
import { FadeIn } from '@/components/FadeIn';
import { Tap } from '@/components/Tap';
import { useDataVersion } from '@/lib/dataEvents';
import { formatDate, formatDuration, formatNumber } from '@/lib/format';
import { monthsShort, plural, t } from '@/lib/i18n';
import { useSettings } from '@/lib/settings';
import { openTrack } from '@/lib/nav';
import { getFriendPlaylist } from '@/lib/friends';
import { getPlaylistDetail, myNames, releaseYear, type PlaylistDetail, type PlaylistTrack } from '@/lib/playlists';
import { contentColumn, makeStyles, radius, useTheme } from '@/lib/theme';

const DAY = 86_400_000;
const FORGOTTEN_AFTER = 90 * DAY;

/** Loads a friend's playlist from the server, in the same shape as your own. */
async function loadFriendPlaylist(friendId: string, friendName: string, id: string): Promise<PlaylistDetail> {
  const { playlist, tracks, statsHidden } = await getFriendPlaylist(friendId, id);
  return {
    ...playlist,
    statsHidden: statsHidden === true,
    tracks: tracks.map(({ releaseDate, ...t }) => ({ ...t, releaseYear: releaseYear(releaseDate) })),
    names: { ...(await myNames()), [friendId]: friendName },
  };
}

/**
 * One playlist against the listening history: yours (from this device), or a
 * friend's (friendId: from the server, with their plays and yours "in common").
 */
export default function PlaylistScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { id, friendId, friendName } = useLocalSearchParams<{ id: string; friendId?: string; friendName?: string }>();
  const version = useDataVersion();
  const [data, setData] = useState<PlaylistDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [showAllNever, setShowAllNever] = useState(false);
  const { language, minStreamSec } = useSettings();
  const friend = friendId ? (friendName ?? t('Il tuo amico')) : null;

  useEffect(() => {
    let cancelled = false;
    (friendId && friend ? loadFriendPlaylist(friendId, friend, id) : getPlaylistDetail(id))
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [id, friendId, friend, version]);

  // The chart hints are translated sentences: recompute them when the language changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stats = useMemo(() => (data ? computeStats(data) : null), [data, language]);

  if (error) {
    return <Text style={[styles.error, { flex: 1, backgroundColor: colors.bg }]}>{error}</Text>;
  }
  if (data === undefined) {
    return <ActivityIndicator color={colors.accent} style={{ flex: 1, backgroundColor: colors.bg }} />;
  }
  if (!data || !stats) {
    return <Text style={[styles.empty, { flex: 1, backgroundColor: colors.bg }]}>{t('Playlist non trovata.')}</Text>;
  }

  const never = showAllNever ? stats.never : stats.never.slice(0, 10);
  // The friend shares the playlist but not how much they listen: show the songs, not the plays.
  const showPlays = !data.statsHidden;

  return (
    <>
      <Stack.Screen options={{ title: data.name }} />
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
        <FadeIn style={styles.hero}>
          <Cover uri={data.imageUrl} size={160} />
          <Text style={styles.title}>{data.name}</Text>
          <Text style={styles.sub}>
            {[
              friend && t('di {name}', { name: friend }),
              plural(stats.count, '{n} brano', '{n} brani'),
              formatDuration(stats.durationMs),
              data.collaborative && t('collaborativa'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </FadeIn>

        {stats.count === 0 ? (
          <Text style={styles.empty}>{t('Questa playlist è vuota.')}</Text>
        ) : (
          <>
            {!showPlays && (
              <Text style={styles.note}>
                {t('{name} ha scelto di non condividere le statistiche di ascolto: qui vedi solo i brani della playlist.', {
                  name: friend ?? '',
                })}
              </Text>
            )}
            {showPlays && (
            <View style={styles.tiles}>
              <Tile
                value={`${Math.round((stats.listened / stats.count) * 100)}%`}
                label={
                  friend
                    ? t('ascoltati da {name} ({listened} su {count})', {
                        name: friend,
                        listened: formatNumber(stats.listened),
                        count: formatNumber(stats.count),
                      })
                    : t('ascoltati ({listened} su {count})', {
                        listened: formatNumber(stats.listened),
                        count: formatNumber(stats.count),
                      })
                }
              />
              <Tile value={formatNumber(stats.never.length)} label={t('mai ascoltati')} />
              <Tile value={formatNumber(stats.plays)} label={t('ascolti di questi brani')} />
              <Tile value={formatDuration(stats.ms)} label={t('tempo su questi brani')} />
              {friend && (
                <Tile
                  value={`${Math.round((stats.common.length / Math.max(1, stats.unique)) * 100)}%`}
                  label={plural(stats.common.length, 'ascoltati anche da te ({n} brano)', 'ascoltati anche da te ({n} brani)')}
                />
              )}
            </View>
            )}
            {showPlays && (
            <Text style={styles.note}>
              {friend
                ? t(
                    'Contano tutti gli ascolti di questi brani di {name}, anche fuori dalla playlist: Spotify non dice da dove sono stati ascoltati.',
                    { name: friend },
                  )
                : t(
                    'Contano tutti gli ascolti di questi brani, anche fuori dalla playlist: Spotify non dice da dove sono stati ascoltati.',
                  )}
              {stats.lastPlayed ? ` ${t('Ultimo ascolto: {date}.', { date: formatDate(stats.lastPlayed) })}` : ''}
            </Text>
            )}

            {showPlays && friend && stats.common.length > 0 && (
              <Section title={t('In comune con te')} hint={t('I brani della playlist che ascolti di più anche tu')}>
                {stats.common.slice(0, 8).map((track) => (
                  <TrackLine
                    key={keyOf(track)}
                    track={track}
                    detail={t('tu {mine} · {name} {theirs}', {
                      mine: formatNumber(track.viewerPlays ?? 0),
                      name: friend,
                      theirs: formatNumber(track.plays),
                    })}
                  />
                ))}
              </Section>
            )}

            {showPlays && stats.top.length > 0 && (
              <Section title={t('I più ascoltati')}>
                {stats.top.map((track, i) => (
                  <TrackLine
                    key={keyOf(track)}
                    track={track}
                    rank={i + 1}
                    detail={plural(track.plays, '{n} ascolto', '{n} ascolti')}
                  />
                ))}
              </Section>
            )}

            {showPlays && stats.forgotten.length > 0 && (
              <Section title={t('Dimenticati')} hint={t('Ascoltati spesso, ma non da almeno 3 mesi')}>
                {stats.forgotten.map((track) => (
                  <TrackLine key={keyOf(track)} track={track} detail={track.lastPlayed ? formatDate(track.lastPlayed) : ''} />
                ))}
              </Section>
            )}

            <Section title={t('Artisti principali')}>
              {stats.artists.map((a) => (
                <View key={a.artist} style={styles.barRow}>
                  <Text style={styles.barLabel} numberOfLines={1}>
                    {a.artist}
                  </Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${(a.count / stats.artists[0].count) * 100}%` }]} />
                  </View>
                  <Text style={styles.barValue}>{a.count}</Text>
                </View>
              ))}
            </Section>

            {stats.added && (
              <Section title={t('Brani aggiunti nel tempo')} hint={stats.added.hint}>
                <BarChart values={stats.added.values} labels={stats.added.labels} />
              </Section>
            )}

            {stats.decades && (
              <Section title={t('Epoca dei brani')} hint={stats.decades.hint}>
                <BarChart values={stats.decades.values} labels={stats.decades.labels} />
              </Section>
            )}

            {stats.addedBy.length > 1 && (
              <Section title={t('Chi ha aggiunto i brani')}>
                {stats.addedBy.map((a) => (
                  <View key={a.id} style={styles.line}>
                    <Text style={styles.name}>{data.names[a.id] ?? a.id}</Text>
                    <Text style={styles.detail}>
                      {plural(a.count, '{n} brano', '{n} brani')}
                      {showPlays ? ` · ${plural(a.plays, '{n} ascolto', '{n} ascolti')}` : ''}
                    </Text>
                  </View>
                ))}
              </Section>
            )}

            {showPlays && stats.never.length > 0 && (
              <Section title={t('Mai ascoltati')} hint={t('Nemmeno una volta per almeno {n} secondi', { n: minStreamSec })}>
                {never.map((track) => (
                  <TrackLine
                    key={keyOf(track)}
                    track={track}
                    detail={track.addedAt ? t('aggiunto {date}', { date: formatDate(track.addedAt) }) : ''}
                  />
                ))}
                {stats.never.length > 10 && (
                  <Tap onPress={() => setShowAllNever((v) => !v)} style={styles.more}>
                    <Text style={styles.moreText}>
                      {showAllNever ? t('Mostra meno') : t('Mostra tutti ({n})', { n: formatNumber(stats.never.length) })}
                    </Text>
                  </Tap>
                )}
              </Section>
            )}

            <Text style={styles.note}>
              {t('Durata media dei brani: {duration}', { duration: formatDuration(stats.durationMs / stats.count) })}
            </Text>
          </>
        )}
      </ScrollView>
    </>
  );
}

const keyOf = (t: PlaylistTrack) => `${t.trackName.toLowerCase()}|${t.artist.toLowerCase()}`;

function computeStats(d: PlaylistDetail) {
  // A song can appear twice in a playlist: count it once.
  const unique = [...new Map(d.tracks.map((t) => [keyOf(t), t])).values()];
  const listened = unique.filter((t) => t.plays > 0);
  const now = Date.now();

  const byArtist = new Map<string, number>();
  for (const t of d.tracks) byArtist.set(t.artist, (byArtist.get(t.artist) ?? 0) + 1);

  const byAdder = new Map<string, { count: number; plays: number }>();
  for (const t of d.tracks) {
    if (!t.addedBy) continue;
    const a = byAdder.get(t.addedBy) ?? { count: 0, plays: 0 };
    a.count += 1;
    a.plays += t.plays;
    byAdder.set(t.addedBy, a);
  }

  return {
    unique: unique.length,
    common: unique.filter((t) => (t.viewerPlays ?? 0) > 0).sort((a, b) => (b.viewerPlays ?? 0) - (a.viewerPlays ?? 0)),
    count: d.tracks.length,
    durationMs: d.tracks.reduce((s, t) => s + t.durationMs, 0),
    listened: listened.length,
    plays: unique.reduce((s, t) => s + t.plays, 0),
    ms: unique.reduce((s, t) => s + t.ms, 0),
    lastPlayed: unique.reduce<number | null>((m, t) => (t.lastPlayed && (!m || t.lastPlayed > m) ? t.lastPlayed : m), null),
    top: [...listened].sort((a, b) => b.plays - a.plays).slice(0, 10),
    forgotten: unique
      .filter(
        (t) =>
          t.plays >= 3 && t.lastPlayed && now - t.lastPlayed > FORGOTTEN_AFTER && (!t.addedAt || now - t.addedAt > FORGOTTEN_AFTER),
      )
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 8),
    never: unique.filter((t) => t.plays === 0),
    artists: [...byArtist.entries()]
      .map(([artist, count]) => ({ artist, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    addedBy: [...byAdder.entries()].map(([id, a]) => ({ id, ...a })).sort((a, b) => b.count - a.count),
    added: addedSeries(d.tracks.map((t) => t.addedAt).filter((x): x is number => !!x), now),
    decades: decadeSeries(d.tracks.map((t) => t.releaseYear).filter((x): x is number => !!x)),
  };
}

/** Songs added per month (last 12) or per year when the playlist spans more than two years. */
function addedSeries(dates: number[], now: number) {
  if (dates.length === 0) return null;
  const first = Math.min(...dates);
  const nowD = new Date(now);
  if (now - first > 2 * 365 * DAY) {
    const from = new Date(first).getFullYear();
    const years = Array.from({ length: nowD.getFullYear() - from + 1 }, (_, i) => from + i).slice(-12);
    const values = years.map((y) => dates.filter((d) => new Date(d).getFullYear() === y).length);
    return { values, labels: years.map((y) => `’${String(y).slice(2)}`), hint: t('Per anno') };
  }
  const months = Array.from({ length: 12 }, (_, i) => new Date(nowD.getFullYear(), nowD.getMonth() - 11 + i, 1));
  const values = months.map(
    (m) => dates.filter((d) => new Date(d).getFullYear() === m.getFullYear() && new Date(d).getMonth() === m.getMonth()).length,
  );
  return { values, labels: months.map((m) => monthsShort()[m.getMonth()].charAt(0)), hint: t('Ultimi 12 mesi') };
}

/** Release years grouped by decade, with the share of the most common one. */
function decadeSeries(years: number[]) {
  if (years.length === 0) return null;
  const decades = [...new Set(years.map((y) => Math.floor(y / 10) * 10))].sort((a, b) => a - b);
  const values = decades.map((dec) => years.filter((y) => Math.floor(y / 10) * 10 === dec).length);
  const top = decades[values.indexOf(Math.max(...values))];
  const share = Math.round((Math.max(...values) / years.length) * 100);
  return {
    values,
    labels: decades.map((dec) => `’${String(dec).slice(2)}`),
    hint: t('{share}% dagli anni {decade} ({from}-{to})', { share, decade: String(top).slice(2), from: top, to: top + 9 }),
  };
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {hint && <Text style={styles.hint}>{hint}</Text>}
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function TrackLine({ track, rank, detail }: { track: PlaylistTrack; rank?: number; detail: string }) {
  const styles = useStyles();
  return (
    <Tap onPress={() => openTrack(track)} style={styles.line} scaleTo={0.985}>
      {rank !== undefined && <Text style={styles.rank}>{rank}</Text>}
      <Cover uri={track.imageUrl} size={40} />
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {track.trackName}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {track.artist}
        </Text>
      </View>
      <Text style={styles.detail}>{detail}</Text>
    </Tap>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  content: { ...contentColumn, padding: 16, paddingBottom: 40, gap: 12 },
  hero: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexGrow: 1, flexBasis: '45%', backgroundColor: colors.card, borderRadius: radius.md, padding: 14, gap: 2 },
  tileValue: { color: colors.text, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tileLabel: { color: colors.muted, fontSize: 12 },
  note: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  section: { gap: 6, marginTop: 8 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  hint: { color: colors.muted, fontSize: 12 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 12, gap: 4 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  rank: { color: colors.muted, width: 20, textAlign: 'right', fontWeight: '600', fontVariant: ['tabular-nums'] },
  info: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  detail: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 30 },
  barLabel: { color: colors.text, fontSize: 13, width: 110 },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.cardAlt, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
  barValue: { color: colors.muted, fontSize: 12, width: 28, textAlign: 'right', fontVariant: ['tabular-nums'] },
  more: { paddingVertical: 10, alignItems: 'center' },
  moreText: { color: colors.accent, fontWeight: '600' },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 32 },
  error: { color: colors.danger, textAlign: 'center', padding: 32 },
}));
