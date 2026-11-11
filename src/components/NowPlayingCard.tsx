import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Cover } from '@/components/Cover';
import { Equalizer } from '@/components/Equalizer';
import { FadeIn } from '@/components/FadeIn';
import { Tap } from '@/components/Tap';
import { useAuth } from '@/lib/auth';
import { getMeta, setMeta } from '@/lib/db';
import { t } from '@/lib/i18n';
import { openLyrics, openTrack } from '@/lib/nav';
import { useNowPlaying, useProgress } from '@/lib/nowPlaying';
import { makeStyles, radius, useTheme } from '@/lib/theme';

const HINT_DISMISSED = 'nowPlayingHintDismissed';

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Home card with the song playing on Spotify right now. Hidden when nothing is playing.
 * Sessions older than this feature see a one-time invitation to log in again, which
 * grants the extra Spotify permission.
 */
export function NowPlayingCard() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { login } = useAuth();
  const now = useNowPlaying();
  const track = now.status === 'playing' ? now.track : null;
  const progress = useProgress(track);
  const [hintDismissed, setHintDismissed] = useState(true);
  const [granting, setGranting] = useState(false);

  useEffect(() => {
    getMeta(HINT_DISMISSED).then((v) => setHintDismissed(v === '1'));
  }, []);

  async function onGrant() {
    setGranting(true);
    try {
      await login();
      now.refresh();
    } finally {
      setGranting(false);
    }
  }

  function onDismiss() {
    setHintDismissed(true);
    setMeta(HINT_DISMISSED, '1').catch(console.warn);
  }

  if (now.status === 'no_scope') {
    if (hintDismissed) return null;
    return (
      <FadeIn style={styles.card}>
        <Text style={styles.kicker}>{t('Novità')}</Text>
        <Text style={styles.hintTitle}>{t('Vedi cosa stai ascoltando ora')}</Text>
        <Text style={styles.hintText}>
          {t('L’app può mostrare qui il brano in riproduzione, e ai tuoi amici quello che ascolti in questo momento. Serve un nuovo permesso di Spotify: accedi di nuovo, i tuoi dati restano dove sono.')}
        </Text>
        <View style={styles.actions}>
          <Tap onPress={onGrant} disabled={granting} dimmed={granting} style={styles.primary} accessibilityRole="button">
            {granting ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.primaryText}>{t('Concedi accesso')}</Text>}
          </Tap>
          <Tap onPress={onDismiss} hitSlop={8} style={styles.secondary} accessibilityRole="button">
            <Text style={styles.secondaryText}>{t('Non ora')}</Text>
          </Tap>
        </View>
      </FadeIn>
    );
  }

  if (!track) return null;

  const share = track.durationMs > 0 ? Math.min(1, progress / track.durationMs) : 0;

  return (
    <FadeIn style={styles.card}>
      <Tap
        style={styles.cardTap}
        onPress={() => openTrack(track)}
        accessibilityRole="button"
        accessibilityLabel={t('{track} di {artist}', { track: track.trackName, artist: track.artist })}
      >
        <View style={styles.head}>
          <Equalizer color={colors.accent} playing={track.isPlaying} />
          <Text style={styles.kicker}>{track.isPlaying ? t('In riproduzione ora') : t('In pausa')}</Text>
        </View>
        <View style={styles.row}>
          <Cover uri={track.imageUrl} size={56} />
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>
              {track.trackName}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {track.album ? `${track.artist} · ${track.album}` : track.artist}
            </Text>
          </View>
        </View>
        <View style={styles.bar}>
          <View style={[styles.fill, { width: `${share * 100}%` }]} />
        </View>
        <View style={styles.times}>
          <Text style={styles.time}>{clock(progress)}</Text>
          <Text style={styles.time}>{clock(track.durationMs)}</Text>
        </View>
      </Tap>
      <Tap
        onPress={openLyrics}
        hitSlop={8}
        style={styles.lyricsBtn}
        accessibilityRole="button"
        accessibilityLabel={t('Testo')}
      >
        <Ionicons name="musical-notes-outline" size={14} color={colors.accent} />
        <Text style={styles.lyricsText}>{t('Testo')}</Text>
      </Tap>
    </FadeIn>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, gap: 10 },
    cardTap: { gap: 10 },
    lyricsBtn: {
      position: 'absolute',
      top: 10,
      right: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.cardAlt,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    lyricsText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    kicker: { color: colors.accent, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    info: { flex: 1, minWidth: 0 },
    name: { color: colors.text, fontSize: 17, fontWeight: '700' },
    sub: { color: colors.muted, fontSize: 13, marginTop: 2 },
    bar: { height: 4, borderRadius: 2, backgroundColor: colors.cardAlt, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: 2, backgroundColor: colors.accent },
    times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
    time: { color: colors.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
    hintTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
    hintText: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 2 },
    primary: { backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, minWidth: 140, alignItems: 'center' },
    primaryText: { color: colors.onAccent, fontWeight: '700' },
    secondary: { paddingVertical: 10 },
    secondaryText: { color: colors.muted, fontWeight: '700' },
  }),
);
