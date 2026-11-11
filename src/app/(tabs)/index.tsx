import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FadeIn } from '@/components/FadeIn';
import { NowPlayingCard } from '@/components/NowPlayingCard';
import { Tap } from '@/components/Tap';
import { TrackRow } from '@/components/TrackRow';
import { YearGoal } from '@/components/YearGoal';
import { useDataVersion } from '@/lib/dataEvents';
import { t } from '@/lib/i18n';
import { getSummary, getTrackStats, type Summary, type TrackStat } from '@/lib/db';
import { formatDate, formatDateTime, formatDuration, formatNumber, msToMinutes, startOfYear } from '@/lib/format';
import { contentColumn, makeStyles, radius, useTheme } from '@/lib/theme';
import { dismissGaps, getOpenGaps, type Gap } from '@/lib/gaps';
import { openTrack } from '@/lib/nav';
import { getRecapYears } from '@/lib/recap';
import { useSync } from '@/lib/useSync';

const DAY = 86_400_000;

export default function SummaryScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { sync, syncing, error, lastSyncAt } = useSync();
  const version = useDataVersion();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [top, setTop] = useState<TrackStat[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [pastYears, setPastYears] = useState<number[]>([]);
  const [range, setRange] = useState(() => ({ from: startOfYear(), daysElapsed: 1 }));

  const year = new Date(range.from).getFullYear();

  useEffect(() => {
    const from = startOfYear();
    const to = Date.now();
    getSummary(from, to).then((s) => {
      setSummary(s);
      setRange({ from, daysElapsed: Math.max(1, Math.ceil((to - from) / DAY)) });
    });
    getTrackStats(from, to, 'plays', { limit: 5 }).then(setTop);
    getOpenGaps().then(setGaps);
    getRecapYears().then((ys) => setPastYears(ys.filter((y) => y < new Date(from).getFullYear())));
  }, [version, lastSyncAt]);

  const onDismissGaps = useCallback(() => {
    dismissGaps().then(() => setGaps([]));
  }, []);

  const { from, daysElapsed } = range;
  // If the oldest play is well after Jan 1st, the yearly total is incomplete.
  const missingHistory = summary?.firstPlayAt == null || summary.firstPlayAt > from + 3 * DAY;

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={syncing} onRefresh={sync} tintColor={colors.accent} />}
    >
      <FadeIn style={styles.hero}>
        <Text style={styles.kicker}>{t('Dal 1° gennaio {year} a oggi', { year })}</Text>
        <Text style={styles.bigNumber}>{formatNumber(msToMinutes(summary?.totalMs ?? 0))}</Text>
        <Text style={styles.bigLabel}>{t('minuti ascoltati')}</Text>
        <Text style={styles.sub}>{t('{duration} di musica', { duration: formatDuration(summary?.totalMs ?? 0) })}</Text>
      </FadeIn>

      <NowPlayingCard />

      {(summary?.streams ?? 0) > 0 && (
        <Link href={{ pathname: '/recap', params: { year: String(year) } }} asChild>
          <Tap style={styles.recap}>
            <View style={{ flex: 1 }}>
              <Text style={styles.recapKicker}>{t('Riepilogo dell’anno')}</Text>
              <Text style={styles.recapTitle}>{t('Il tuo {year} in musica', { year })}</Text>
              <Text style={styles.recapText}>{t('Artista, canzone e mese top, le tue abitudini e altro')}</Text>
            </View>
            <Ionicons name="play-circle" size={44} color="#FFFFFF" />
          </Tap>
        </Link>
      )}

      {pastYears.length > 0 && (
        <View style={styles.pastYears}>
          <Text style={styles.pastLabel}>
            {new Date().getMonth() === 0 && pastYears[0] === year - 1
              ? t('Anno nuovo! Rivedi il tuo {year}:', { year: year - 1 })
              : t('Riepiloghi degli anni passati:')}
          </Text>
          <View style={styles.pastChips}>
            {pastYears.map((y) => (
              <Link key={y} href={{ pathname: '/recap', params: { year: String(y) } }} style={styles.pastChip}>
                {y}
              </Link>
            ))}
          </View>
        </View>
      )}

      <FadeIn delay={80} style={styles.tiles}>
        <Tile label={t('Ascolti')} value={formatNumber(summary?.streams ?? 0)} />
        <Tile label={t('Brani diversi')} value={formatNumber(summary?.uniqueTracks ?? 0)} />
        <Tile label={t('Min / giorno')} value={formatNumber(msToMinutes(summary?.totalMs ?? 0) / daysElapsed)} />
      </FadeIn>

      <YearGoal year={year} minutes={msToMinutes(summary?.totalMs ?? 0)} />

      {gaps.length > 0 && (
        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>{t('Potrebbero mancare alcuni ascolti')}</Text>
          <Text style={styles.bannerText}>
            {gaps.length === 1
              ? t('Tra {from} e {to}', { from: formatDateTime(gaps[0].from), to: formatDateTime(gaps[0].to) })
              : t('In {n} momenti, l’ultimo tra {from} e {to}', {
                  n: gaps.length,
                  from: formatDateTime(gaps[gaps.length - 1].from),
                  to: formatDateTime(gaps[gaps.length - 1].to),
                })}{' '}
            {t(
              'l’app non si è aggiornata per più di 50 brani (Spotify mostra solo gli ultimi 50). Importa la cronologia estesa da Impostazioni per recuperarli: l’avviso sparisce da solo.',
            )}
          </Text>
          <View style={styles.bannerActions}>
            <Link href="/settings" style={styles.bannerLink}>
              {t('Importa cronologia')}
            </Link>
            <Tap onPress={onDismissGaps} hitSlop={8}>
              <Text style={styles.bannerDismiss}>{t('Ignora')}</Text>
            </Tap>
          </View>
        </View>
      )}

      {missingHistory && (
        <Link href="/settings" asChild>
          <Tap style={styles.banner}>
            <Text style={styles.bannerTitle}>{t('Mancano dati di inizio anno')}</Text>
            <Text style={styles.bannerText}>
              {summary?.firstPlayAt
                ? t('I dati partono dal {date}.', { date: formatDate(summary.firstPlayAt) })
                : t('Non ci sono ancora ascolti salvati.')}{' '}
              {t(
                'Spotify mostra all’app solo gli ultimi 50 brani: importa la tua cronologia per avere il totale completo. Tocca per sapere come →',
              )}
            </Text>
          </Tap>
        </Link>
      )}

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{t('Più ascoltate')}</Text>
          <Link href="/tracks" style={styles.link}>
            {t('Vedi tutte')}
          </Link>
        </View>
        {top.length === 0 ? (
          <Text style={styles.empty}>{t('Ascolta qualcosa su Spotify e trascina giù per aggiornare.')}</Text>
        ) : (
          top.map((track, i) => (
            <TrackRow key={`${track.trackName}|${track.artist}`} rank={i + 1} track={track} onPress={openTrack} />
          ))
        )}
      </View>

      <Text style={styles.status}>
        {error
          ? t('Sincronizzazione non riuscita: {error}', { error })
          : lastSyncAt
            ? t('Ultimo aggiornamento: {date}', { date: formatDateTime(lastSyncAt) })
            : t('Sincronizzazione…')}
      </Text>
    </ScrollView>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  content: { ...contentColumn, padding: 16, gap: 16, paddingBottom: 32 },
  hero: {
    backgroundColor: colors.accentDim,
    borderRadius: radius.lg,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  kicker: { color: colors.accent, fontWeight: '700', fontSize: 13, letterSpacing: 0.5 },
  bigNumber: { color: colors.text, fontSize: 64, fontWeight: '900', fontVariant: ['tabular-nums'], marginTop: 8 },
  bigLabel: { color: colors.text, fontSize: 18, fontWeight: '600', marginTop: -4 },
  sub: { color: colors.muted, marginTop: 8 },
  recap: {
    backgroundColor: '#7C3AED',
    borderRadius: radius.lg,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  recapKicker: { color: '#E9D5FF', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  recapTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', marginTop: 2 },
  recapText: { color: '#F3E8FF', fontSize: 13, marginTop: 4 },
  tiles: { flexDirection: 'row', gap: 10 },
  pastYears: { gap: 8 },
  pastLabel: { color: colors.muted, fontSize: 13 },
  pastChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pastChip: {
    color: colors.recapChip,
    fontWeight: '800',
    borderWidth: 1.5,
    borderColor: '#7C3AED',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  tile: { flex: 1, backgroundColor: colors.card, borderRadius: radius.md, padding: 14 },
  tileValue: { color: colors.text, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tileLabel: { color: colors.muted, fontSize: 12, marginTop: 4 },
  banner: { backgroundColor: colors.warnDim, borderRadius: radius.md, padding: 14, gap: 4 },
  bannerTitle: { color: colors.warn, fontWeight: '700' },
  bannerText: { color: colors.text, lineHeight: 20, fontSize: 13 },
  bannerActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  bannerLink: { color: colors.warn, fontWeight: '700' },
  bannerDismiss: { color: colors.muted, fontWeight: '700' },
  card: { backgroundColor: colors.card, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  link: { color: colors.accent, fontWeight: '600' },
  empty: { color: colors.muted, paddingVertical: 16, textAlign: 'center' },
  status: { color: colors.muted, fontSize: 12, textAlign: 'center' },
}));
