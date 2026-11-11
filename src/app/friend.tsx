import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Cover } from '@/components/Cover';
import { Equalizer } from '@/components/Equalizer';
import { FadeIn } from '@/components/FadeIn';
import { Tap } from '@/components/Tap';
import { ensureArtistImages, ensureTrackCovers, songKey } from '@/lib/covers';
import { askConfirm, showMessage } from '@/lib/dialog';
import { formatDateTime, formatDuration, formatNumber } from '@/lib/format';
import {
  displayName,
  getFriendPlaylists,
  getFriendProfile,
  getFriendsNowPlaying,
  removeFriend,
  NOTHING_HIDDEN,
  type FriendNowPlaying,
  type FriendPlaylist,
  type FriendPlaylistsStatus,
  type HiddenParts,
  type FriendProfile,
  type Person,
} from '@/lib/friends';
import { plural, t } from '@/lib/i18n';
import { PERIODS, periodPhrase, periodRange, type Period } from '@/lib/period';
import { contentColumn, makeStyles, radius, useTheme } from '@/lib/theme';

/** A friend's listening: totals, top artists and songs of a period, latest plays. */
export default function FriendScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [period, setPeriod] = useState<Period>('month');
  const [data, setData] = useState<{ period: Period; person: Person; profile: FriendProfile; hidden: HiddenParts } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<{ status: FriendPlaylistsStatus; playlists: FriendPlaylist[] } | null>(
    null,
  );

  const [playing, setPlaying] = useState<FriendNowPlaying | null>(null);

  // What they're listening to right now, checked twice a minute while the screen is open.
  useEffect(() => {
    let cancelled = false;
    const load = () => getFriendsNowPlaying().then((now) => !cancelled && setPlaying(now[id] ?? null));
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id]);

  // Playlists don't depend on the period: load them once (the server caches them for a few hours).
  useEffect(() => {
    let cancelled = false;
    getFriendPlaylists(id)
      .then((p) => !cancelled && setPlaylists(p))
      .catch((e) => console.warn('friend playlists', e));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    const { from, to } = periodRange(period);
    getFriendProfile(id, from, to)
      .then(async (res) => {
        if (cancelled) return;
        // Servers older than the privacy choices don't say what is hidden: nothing is.
        const hidden = res.hidden ?? NOTHING_HIDDEN;
        setData({ period, person: res.person, profile: res.profile, hidden });
        // Their imported plays may have no artwork: look it up (cached on this device).
        const { profile } = res;
        const [tracks, artists] = await Promise.all([
          ensureTrackCovers([...profile.topTracks, ...profile.recent]).catch(() => new Map<string, string>()),
          ensureArtistImages(profile.topArtists.map((a) => a.artist)).catch(() => new Map<string, string>()),
        ]);
        if (cancelled || (tracks.size === 0 && artists.size === 0)) return;
        const cover = <T extends { trackName: string; artist: string; imageUrl: string | null }>(t: T): T =>
          t.imageUrl ? t : { ...t, imageUrl: tracks.get(songKey(t)) ?? null };
        setData({
          period,
          hidden,
          person: res.person,
          profile: {
            ...profile,
            topTracks: profile.topTracks.map(cover),
            recent: profile.recent.map(cover),
            // Artist photos beat the album cover the server picked.
            topArtists: profile.topArtists.map((a) => ({ ...a, imageUrl: artists.get(a.artist.toLowerCase()) ?? a.imageUrl })),
          },
        });
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [id, period]);

  function choosePeriod(p: Period) {
    setError(null);
    setPeriod(p);
  }

  const person = data?.person;
  const title = person ? displayName(person) : (name ?? t('Amico'));

  async function onRemove() {
    const question = t('Rimuovere {name} dagli amici? Non vedrete più i rispettivi ascolti.', { name: title });
    if (!(await askConfirm(t('Rimuovi amico'), question, t('Rimuovi'), true))) return;
    try {
      await removeFriend(id);
      router.back();
    } catch (e) {
      showMessage(t('Errore'), e instanceof Error ? e.message : String(e));
    }
  }

  const loading = !data || data.period !== period;

  return (
    <>
      <Stack.Screen options={{ title }} />
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
        <FadeIn style={styles.hero}>
          <Avatar uri={person?.avatar ?? null} name={title} size={88} />
          <Text style={styles.title}>{title}</Text>
          {person && <Text style={styles.sub}>{person.email}</Text>}
        </FadeIn>

        {playing && (
          <FadeIn style={styles.playing}>
            <Cover uri={playing.imageUrl} size={44} />
            <View style={styles.info}>
              <View style={styles.playingHead}>
                <Equalizer color={colors.accent} size={11} />
                <Text style={styles.playingKicker}>{t('In riproduzione ora')}</Text>
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {playing.trackName}
              </Text>
              <Text style={styles.sub} numberOfLines={1}>
                {playing.artist}
              </Text>
            </View>
          </FadeIn>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {PERIODS.map((p) => {
            const active = p.key === period;
            return (
              <Tap
                key={p.key}
                onPress={() => choosePeriod(p.key)}
                style={[styles.chip, active && styles.chipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{t(p.label)}</Text>
              </Tap>
            );
          })}
        </ScrollView>

        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
        ) : data.hidden.stats ? (
          <Text style={styles.empty}>
            {t('{name} ha scelto di non condividere le statistiche di ascolto.', { name: title })}
          </Text>
        ) : data.profile.summary.streams === 0 ? (
          <Text style={styles.empty}>{t('Nessun ascolto {period}.', { period: periodPhrase(period) })}</Text>
        ) : (
          <>
            <View style={styles.tiles}>
              <Tile label={t('Tempo')} value={formatDuration(data.profile.summary.totalMs)} />
              <Tile label={t('Ascolti')} value={formatNumber(data.profile.summary.streams)} />
              <Tile label={t('Brani')} value={formatNumber(data.profile.summary.tracks)} />
              <Tile label={t('Artisti')} value={formatNumber(data.profile.summary.artists)} />
            </View>

            <Text style={styles.sectionTitle}>{t('Artisti più ascoltati')}</Text>
            <View style={styles.card}>
              {data.profile.topArtists.map((a, i) => (
                <Row key={a.artist} rank={i + 1} imageUrl={a.imageUrl} round title={a.artist} detail={formatDuration(a.totalMs)} />
              ))}
            </View>

            <Text style={styles.sectionTitle}>{t('Brani più ascoltati')}</Text>
            <View style={styles.card}>
              {data.profile.topTracks.map((track, i) => (
                <Row
                  key={`${track.trackName}|${track.artist}`}
                  rank={i + 1}
                  imageUrl={track.imageUrl}
                  title={track.trackName}
                  subtitle={track.artist}
                  detail={plural(track.plays, '{n} ascolto', '{n} ascolti')}
                />
              ))}
            </View>
          </>
        )}

        {data && !loading && data.hidden.recent && (
          <>
            <Text style={styles.sectionTitle}>{t('Ascoltati di recente')}</Text>
            <Text style={styles.hintText}>{t('{name} ha scelto di non condividere gli ascolti recenti.', { name: title })}</Text>
          </>
        )}

        {data && data.profile.recent.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{t('Ascoltati di recente')}</Text>
            <View style={styles.card}>
              {data.profile.recent.map((r) => (
                <Row
                  key={`${r.playedAt}|${r.trackName}`}
                  imageUrl={r.imageUrl}
                  title={r.trackName}
                  subtitle={r.artist}
                  detail={formatDateTime(r.playedAt)}
                />
              ))}
            </View>
          </>
        )}

        {playlists && (
          <>
            <Text style={styles.sectionTitle}>{t('Playlist')}</Text>
            {playlists.status !== 'ok' && playlists.playlists.length === 0 ? (
              <Text style={styles.hintText}>
                {playlists.status === 'hidden'
                  ? t('{name} ha scelto di non condividere le playlist.', { name: title })
                  : playlists.status === 'no_token'
                  ? t('{name} deve aggiornare l’app e aprirla una volta per mostrarti le sue playlist.', { name: title })
                  : t('{name} deve aprire la scheda Playlist e concedere l’accesso a Spotify.', { name: title })}
              </Text>
            ) : playlists.playlists.length === 0 ? (
              <Text style={styles.hintText}>{t('Nessuna playlist.')}</Text>
            ) : (
              <View style={styles.card}>
                {playlists.playlists.map((p) => (
                  <Tap
                    key={p.id}
                    disabled={!p.readable}
                    onPress={() =>
                      router.push({ pathname: '/playlist', params: { id: p.id, friendId: id, friendName: title } })
                    }
                    style={styles.row}
                    scaleTo={0.985}
                  >
                    <Cover uri={p.imageUrl} size={44} />
                    <View style={styles.info}>
                      <Text style={styles.name} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text style={styles.sub} numberOfLines={1}>
                        {p.readable
                          ? [plural(p.total, '{n} brano', '{n} brani'), p.collaborative && t('collaborativa')]
                              .filter(Boolean)
                              .join(' · ')
                          : `${t('salvata')} · ${t('di {name}', { name: p.ownerName ?? t('altri') })}`}
                      </Text>
                    </View>
                    {p.readable && <Text style={styles.chevron}>›</Text>}
                  </Tap>
                ))}
              </View>
            )}
          </>
        )}

        {person && (
          <Tap onPress={onRemove} style={styles.remove} accessibilityRole="button">
            <Text style={styles.removeText}>{t('Rimuovi dagli amici')}</Text>
          </Tap>
        )}
      </ScrollView>
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
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

function Row(props: { rank?: number; imageUrl: string | null; round?: boolean; title: string; subtitle?: string; detail: string }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      {props.rank !== undefined && <Text style={styles.rank}>{props.rank}</Text>}
      <Cover uri={props.imageUrl} size={40} round={props.round} />
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {props.title}
        </Text>
        {props.subtitle && (
          <Text style={styles.sub} numberOfLines={1}>
            {props.subtitle}
          </Text>
        )}
      </View>
      <Text style={styles.detail}>{props.detail}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  content: { ...contentColumn, padding: 16, paddingBottom: 40, gap: 12 },
  hero: { alignItems: 'center', gap: 6, paddingVertical: 8 },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  playing: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: radius.lg, padding: 12 },
  playingHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  playingKicker: { color: colors.accent, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  chips: { gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: colors.card },
  chipActive: { backgroundColor: colors.accent },
  chipText: { color: colors.muted, fontWeight: '600', fontSize: 13 },
  chipTextActive: { color: colors.onAccent },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexGrow: 1, flexBasis: '45%', backgroundColor: colors.card, borderRadius: radius.md, padding: 14, gap: 2 },
  tileValue: { color: colors.text, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tileLabel: { color: colors.muted, fontSize: 12 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 8 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  rank: { color: colors.muted, width: 20, textAlign: 'right', fontWeight: '600', fontVariant: ['tabular-nums'] },
  info: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 15, fontWeight: '600' },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  detail: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 24 },
  error: { color: colors.danger, textAlign: 'center', paddingVertical: 24 },
  hintText: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  chevron: { color: colors.muted, fontSize: 22, paddingHorizontal: 4 },
  remove: { alignSelf: 'center', marginTop: 16, paddingVertical: 10, paddingHorizontal: 16 },
  removeText: { color: colors.danger, fontWeight: '600' },
}));
