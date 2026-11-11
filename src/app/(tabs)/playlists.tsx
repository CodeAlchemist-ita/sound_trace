import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Cover } from '@/components/Cover';
import { FadeIn } from '@/components/FadeIn';
import { Tap } from '@/components/Tap';
import { useAuth } from '@/lib/auth';
import { notifyDataChanged } from '@/lib/dataEvents';
import { formatNumber } from '@/lib/format';
import { plural, t } from '@/lib/i18n';
import {
  getPlaylistOverview,
  getPlaylistSummaries,
  syncPlaylists,
  type PlaylistOverview,
  type PlaylistSummary,
} from '@/lib/playlists';
import { contentColumn, makeStyles, radius, useTheme } from '@/lib/theme';

export default function PlaylistsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { login } = useAuth();
  const [list, setList] = useState<PlaylistSummary[] | null>(null);
  const [overview, setOverview] = useState<PlaylistOverview | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [granting, setGranting] = useState(false);

  const loadLocal = useCallback(async () => {
    const [l, o] = await Promise.all([getPlaylistSummaries(), getPlaylistOverview()]);
    setList(l);
    setOverview(o);
  }, []);

  const refresh = useCallback(
    async (force: boolean) => {
      try {
        const result = await syncPlaylists(force);
        setNeedsPermission(result === 'no_scope');
        setError(null);
        if (result === 'ok') notifyDataChanged(); // plays may have borrowed playlist covers
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      await loadLocal();
    },
    [loadLocal],
  );

  // Show what's saved at once, then update from Spotify (at most every few hours).
  useFocusEffect(
    useCallback(() => {
      loadLocal().then(() => refresh(false));
    }, [loadLocal, refresh]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await refresh(true);
    setRefreshing(false);
  }

  async function onGrant() {
    // A new Spotify login asks for the playlist permission too; then download right away
    // (here and on the server, so friends see them without waiting).
    setGranting(true);
    try {
      await login();
      await refresh(true);
    } finally {
      setGranting(false);
    }
  }

  const own = list?.filter((p) => p.readable) ?? [];
  const others = list?.filter((p) => !p.readable) ?? [];

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      {needsPermission && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('Serve un permesso in più')}</Text>
          <Text style={styles.text}>
            {t('Per leggere le tue playlist l’app deve chiedere a Spotify un nuovo permesso. Accedi di nuovo: i tuoi dati restano dove sono.')}
          </Text>
          <Tap onPress={onGrant} disabled={granting} dimmed={granting} style={styles.primary} accessibilityRole="button">
            {granting ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={styles.primaryText}>{t('Concedi accesso alle playlist')}</Text>
            )}
          </Tap>
        </View>
      )}

      {granting && !needsPermission && (
        <View style={styles.syncing}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.text}>{t('Scarico le tue playlist da Spotify…')}</Text>
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
      {!list && <ActivityIndicator color={colors.accent} style={{ marginTop: 32 }} />}

      {list && list.length === 0 && !needsPermission && !error && (
        <Text style={styles.empty}>{t('Nessuna playlist trovata nella tua libreria.')}</Text>
      )}

      {overview && own.length > 0 && (
        <FadeIn style={styles.tiles}>
          <Tile value={formatNumber(own.length)} label={plural(own.length, 'playlist tua', 'playlist tue')} />
          <Tile
            value={`${Math.round(overview.shareInPlaylists * 100)}%`}
            label={t('degli ascolti dell’ultimo anno sono brani delle tue playlist')}
          />
          <Tile value={formatNumber(overview.inSeveralCount)} label={t('brani presenti in più playlist')} />
        </FadeIn>
      )}

      {own.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>{t('Le tue playlist')}</Text>
          <Text style={styles.hint}>{t('Ordinate per ascolti degli ultimi 30 giorni')}</Text>
          <View style={styles.list}>
            {own.map((p) => (
              <PlaylistRow key={p.id} p={p} />
            ))}
          </View>
        </>
      )}

      {overview && overview.inSeveral.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>{t('Nelle tue playlist più volte')}</Text>
          <View style={styles.list}>
            {overview.inSeveral.map((song) => (
              <View key={`${song.trackName}|${song.artist}`} style={styles.row}>
                <Cover uri={song.imageUrl} size={44} />
                <View style={styles.info}>
                  <Text style={styles.name} numberOfLines={1}>
                    {song.trackName}
                  </Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {song.artist}
                  </Text>
                </View>
                <Text style={styles.metric}>{t('in {n}', { n: song.playlists })}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {others.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>{t('Salvate da altri')}</Text>
          <Text style={styles.hint}>
            {t('Spotify fa vedere i brani solo delle playlist create da te o collaborative: di queste solo nome e copertina.')}
          </Text>
          <View style={styles.list}>
            {others.map((p) => (
              <PlaylistRow key={p.id} p={p} />
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function PlaylistRow({ p }: { p: PlaylistSummary }) {
  const styles = useStyles();
  const parts = p.readable
    ? [
        plural(p.tracks, '{n} brano', '{n} brani'),
        t('{percent}% ascoltati', { percent: p.tracks ? Math.round((p.listened / p.tracks) * 100) : 0 }),
        p.collaborative && t('collaborativa'),
      ]
    : [t('di {name}', { name: p.ownerName ?? t('altri') }), p.total > 0 && plural(p.total, '{n} brano', '{n} brani')];
  const sub = parts.filter(Boolean).join(' · ');
  return (
    <Tap
      disabled={!p.readable}
      onPress={() => router.push({ pathname: '/playlist', params: { id: p.id } })}
      style={styles.row}
      scaleTo={0.985}
    >
      <Cover uri={p.imageUrl} size={52} />
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {p.name}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      {p.readable && (
        <View style={styles.right}>
          <Text style={styles.metric}>{formatNumber(p.recentPlays)}</Text>
          <Text style={styles.metricLabel}>{t('ascolti 30 gg')}</Text>
        </View>
      )}
    </Tap>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  content: { ...contentColumn, padding: 16, paddingBottom: 32, gap: 10 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, gap: 10 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  text: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  primary: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  primaryText: { color: colors.onAccent, fontWeight: '700' },
  syncing: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center', paddingVertical: 8 },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, backgroundColor: colors.card, borderRadius: radius.md, padding: 12, gap: 4 },
  tileValue: { color: colors.text, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tileLabel: { color: colors.muted, fontSize: 11, lineHeight: 14 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 12 },
  hint: { color: colors.muted, fontSize: 12, marginTop: -4 },
  list: { backgroundColor: colors.card, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 66 },
  info: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 15, fontWeight: '600' },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  metric: { color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  metricLabel: { color: colors.muted, fontSize: 11 },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 32 },
  error: { color: colors.danger, textAlign: 'center' },
}));
