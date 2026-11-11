import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ArtistRow } from '@/components/ArtistRow';
import { BarChart } from '@/components/BarChart';
import { Cover } from '@/components/Cover';
import { FadeIn } from '@/components/FadeIn';
import { Heatmap } from '@/components/Heatmap';
import { PeriodChips } from '@/components/PeriodChips';
import { Tap } from '@/components/Tap';
import { notifyDataChanged, useDataVersion } from '@/lib/dataEvents';
import { monthsShort, msg, plural, t, weekdayOrder, weekdaysShort, weekdayWithArticle } from '@/lib/i18n';
import { useSettings } from '@/lib/settings';
import {
  countDiscoveries,
  countSkips,
  getArtistStats,
  getForgottenTracks,
  getGenreStats,
  getHourBuckets,
  getSessionStats,
  getSummary,
  getTrackStats,
  type ArtistStat,
  type ForgottenTrack,
  type SessionStats,
  type Summary,
  type TrackStat,
} from '@/lib/db';
import { formatDate, formatDateTime, formatDecimal, formatDuration, formatNumber, msToMinutes } from '@/lib/format';
import { fillMissingCovers } from '@/lib/covers';
import { fillMissingGenres } from '@/lib/genres';
import { openArtist, openDay, openTrack } from '@/lib/nav';
import { periodPhrase, periodRange, periodYear, previousRange, type Period } from '@/lib/period';
import { partOfDay } from '@/lib/recap';
import { contentColumn, makeStyles, radius, useTheme } from '@/lib/theme';
import {
  aggregate,
  indexOfMax,
  lastDays,
  lastMonths,
  longestStreak,
  topDay,
  type TimeStats,
} from '@/lib/timeStats';

const DAY = 86_400_000;

type Previous = { label: string; summary: Summary; artists: number; tracks: TrackStat[] };
type Mover = { track: TrackStat; delta: number; isNew: boolean };

type Data = {
  period: Period;
  summary: Summary;
  artists: ArtistStat[];
  tracks: TrackStat[];
  time: TimeStats;
  discoveries: { tracks: number; artists: number };
  skips: { skipped: number; total: number };
  sessions: SessionStats;
  genres: { genres: { genre: string; ms: number }[]; coveredMs: number };
  forgotten: ForgottenTrack[];
  previous: Previous | null;
  days: number;
  /** Year shown in the calendar and its days (the period's year, else the current one). */
  calendar: { year: number; days: TimeStats['days'] };
};

const PART_LABEL = {
  mattina: msg('la mattina'),
  pomeriggio: msg('il pomeriggio'),
  sera: msg('la sera'),
  notte: msg('di notte'),
};

export default function StatsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const version = useDataVersion();
  // Opens on the current year so the calendar and the comparisons are visible right away.
  const [period, setPeriod] = useState<Period>('year');
  const [data, setData] = useState<Data | null>(null);
  // The comparison label is a translated sentence: rebuild it when the language changes.
  const { language } = useSettings();

  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    const { from, to } = periodRange(period, now);
    const prev = previousRange(period, now);
    const calendarYear = periodYear(period) ?? new Date(now).getFullYear();
    const yearStart = new Date(calendarYear, 0, 1).getTime();
    Promise.all([
      getSummary(from, to),
      getArtistStats(from, to, 'time'),
      getTrackStats(from, to, 'plays'),
      getHourBuckets(from, to),
      countDiscoveries(from, to),
      countSkips(from, to),
      getSessionStats(from, to),
      getGenreStats(from, to),
      getForgottenTracks(10, now - 90 * DAY, 5),
      prev
        ? Promise.all([
            getSummary(prev.from, prev.to),
            getArtistStats(prev.from, prev.to, 'time'),
            getTrackStats(prev.from, prev.to, 'plays'),
          ]).then(([summary, artists, tracks]) => ({ label: prev.label, summary, artists: artists.length, tracks }))
        : Promise.resolve(null),
      // The calendar always shows a whole year, even for 7/30 days or "Sempre".
      periodYear(period) === null ? getHourBuckets(yearStart, now) : Promise.resolve(null),
    ]).then(([summary, artists, tracks, buckets, discoveries, skips, sessions, genres, forgotten, previous, yearBuckets]) => {
      if (cancelled) return;
      // "Sempre" starts at the first saved play, not at 1970.
      const start = period === 'all' ? (summary.firstPlayAt ?? to) : from;
      const time = aggregate(buckets);
      setData({
        period,
        summary,
        artists,
        tracks,
        time,
        calendar: { year: calendarYear, days: yearBuckets ? aggregate(yearBuckets).days : time.days },
        discoveries,
        skips,
        sessions,
        genres,
        forgotten,
        previous,
        days: Math.max(1, Math.ceil((to - start) / DAY)),
      });
    });
    // Genres and artwork come from Spotify: fetch the missing ones for this period (re-renders via notifyDataChanged).
    fillMissingGenres(from, to)
      .then((saved) => saved > 0 && notifyDataChanged())
      .then(() => fillMissingCovers(from, to))
      .then((added) => added > 0 && notifyDataChanged())
      .catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [period, version, language]);

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <PeriodChips value={period} onChange={setPeriod} />
      {!data || data.period !== period ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : data.summary.streams === 0 ? (
        <Text style={styles.empty}>{t('Nessun ascolto {period}.', { period: periodPhrase(period) })}</Text>
      ) : (
        <StatsBody data={data} />
      )}
    </ScrollView>
  );
}

function StatsBody({ data }: { data: Data }) {
  const styles = useStyles();
  const { minStreamSec } = useSettings();
  const { summary, time, period, previous } = data;
  const minutes = msToMinutes(summary.totalMs);
  const trend = trendSeries(time, period);
  const favDay = indexOfMax(time.weekdays);
  const part = partOfDay(time.hours);
  const streak = longestStreak(time.days.keys());
  const record = topDay(time.days);
  const skipShare = data.skips.total > 0 ? data.skips.skipped / data.skips.total : null;
  const movers = previous ? computeMovers(data.tracks, previous.tracks) : null;
  const variety = computeVariety(data.artists, data.tracks, summary.streams);

  return (
    <>
      <View style={styles.tiles}>
        <Tile
          label={t('Minuti ascoltati')}
          value={formatNumber(minutes)}
          delta={delta(minutes, previous && msToMinutes(previous.summary.totalMs))}
        />
        <Tile label={t('Ascolti')} value={formatNumber(summary.streams)} delta={delta(summary.streams, previous?.summary.streams)} />
        <Tile
          label={t('Brani diversi')}
          value={formatNumber(summary.uniqueTracks)}
          delta={delta(summary.uniqueTracks, previous?.summary.uniqueTracks)}
        />
        <Tile label={t('Artisti diversi')} value={formatNumber(data.artists.length)} delta={delta(data.artists.length, previous?.artists)} />
        <Tile label={t('Minuti al giorno')} value={formatNumber(minutes / data.days)} />
        <Tile label={t('Giorni con musica')} value={`${formatNumber(time.days.size)}/${formatNumber(data.days)}`} />
        <Tile label={t('Brani scoperti')} value={formatNumber(data.discoveries.tracks)} hint={t('mai ascoltati prima')} />
        <Tile label={t('Artisti scoperti')} value={formatNumber(data.discoveries.artists)} hint={t('mai ascoltati prima')} />
      </View>
      {previous && (
        <Text style={styles.compareNote}>{t('Percentuali calcolate {comparison}.', { comparison: previous.label })}</Text>
      )}

      <Card title={t('Andamento')}>
        <BarChart values={trend.values} labels={trend.labels} highlight={trend.highlight} />
        <Text style={styles.note}>{trend.caption}</Text>
      </Card>

      {data.calendar.days.size > 0 && (
        <Card title={t('Calendario {year}', { year: data.calendar.year })}>
          <Heatmap year={data.calendar.year} days={data.calendar.days} onPressDay={openDay} />
          <Text style={styles.note}>{t('Più è scuro, più hai ascoltato. Tocca un giorno per vedere cosa hai ascoltato.')}</Text>
        </Card>
      )}

      {movers && (movers.up.length > 0 || movers.down.length > 0) && (
        <Card title={t('In salita e in discesa')}>
          <Text style={styles.note}>{t('Variazione degli ascolti {comparison}.', { comparison: previous?.label ?? '' })}</Text>
          {movers.up.map((m) => (
            <MoverRow key={`u|${m.track.trackName}|${m.track.artist}`} mover={m} />
          ))}
          {movers.up.length > 0 && movers.down.length > 0 && <View style={styles.divider} />}
          {movers.down.map((m) => (
            <MoverRow key={`d|${m.track.trackName}|${m.track.artist}`} mover={m} />
          ))}
        </Card>
      )}

      <Card title={t('Giorni della settimana')}>
        <BarChart
          values={weekdayOrder().map((i) => time.weekdays[i])}
          labels={weekdayOrder().map((i) => weekdaysShort()[i])}
          height={100}
        />
        <Text style={styles.note}>{t('Il giorno in cui ascolti di più è {day}.', { day: weekdayWithArticle(favDay) })}</Text>
      </Card>

      <Card title={t('Ore del giorno')}>
        <BarChart values={time.hours} labels={time.hours.map((_, h) => (h % 6 === 0 ? String(h) : ''))} height={100} />
        <Text style={styles.note}>
          {t('Ascolti soprattutto {part} ({percent}% dei minuti).', {
            part: t(PART_LABEL[part.name]),
            percent: Math.round(part.share * 100),
          })}
        </Text>
      </Card>

      {data.sessions.sessions > 0 && (
        <Card title={t('Sessioni di ascolto')}>
          <Text style={styles.note}>{t('Una sessione finisce dopo 30 minuti senza musica.')}</Text>
          <Line label={t('Sessioni')} value={formatNumber(data.sessions.sessions)} />
          <Line label={t('Durata media')} value={formatDuration(data.sessions.avgMs)} />
          <Line label={t('Brani per sessione')} value={formatDecimal(data.sessions.avgTracks)} />
          {data.sessions.longest && (
            <Line
              label={t('Sessione più lunga')}
              value={`${formatDuration(data.sessions.longest.ms)} · ${formatDateTime(data.sessions.longest.start)}`}
            />
          )}
        </Card>
      )}

      <Card title={t('Artisti più ascoltati')}>
        {data.artists.slice(0, 5).map((a, i) => (
          <ArtistRow key={a.artist} rank={i + 1} artist={a} onPress={openArtist} />
        ))}
      </Card>

      <Card title={t('Generi')}>
        {data.genres.genres.length === 0 ? (
          <Text style={styles.note}>
            {t('I generi arrivano da Spotify per i tuoi artisti più ascoltati: se non compaiono, sono ancora in caricamento oppure Spotify non li indica per questi artisti.')}
          </Text>
        ) : (
          <>
            {data.genres.genres.slice(0, 8).map((g) => (
              <GenreBar key={g.genre} genre={g.genre} share={g.ms / Math.max(1, data.genres.coveredMs)} />
            ))}
            <Text style={styles.note}>
              {t('Quota dei minuti degli artisti di cui Spotify indica i generi. Un artista può avere più generi.')}
            </Text>
          </>
        )}
      </Card>

      <Card title={t('Varietà')}>
        <Text style={styles.varietyTitle}>{t(variety.label)}</Text>
        <Text style={styles.note}>
          {t('Il {percent}% dei tuoi ascolti viene dai tuoi 10 artisti preferiti.', {
            percent: Math.round(variety.top10Share * 100),
          })}{' '}
          {plural(
            variety.oneTimers,
            '{n} brano ({percent}%) lo hai ascoltato una sola volta.',
            '{n} brani ({percent}%) li hai ascoltati una sola volta.',
            { percent: Math.round(variety.oneTimerShare * 100) },
          )}
        </Text>
        <View style={styles.meter}>
          <View style={[styles.meterFill, { width: `${Math.round(variety.top10Share * 100)}%` }]} />
        </View>
        <View style={styles.meterLabels}>
          <Text style={styles.meterLabel}>{t('Esploratore')}</Text>
          <Text style={styles.meterLabel}>{t('Fedele')}</Text>
        </View>
      </Card>

      <Card title={t('Record e abitudini')}>
        {record && (
          <Tap onPress={() => openDay(record.date)} scaleTo={0.985}>
            <Line label={t('Giorno record')} value={`${formatDuration(record.ms)} · ${formatDate(record.date)} ›`} />
          </Tap>
        )}
        {streak && streak.days > 1 && (
          <Line
            label={t('Giorni di fila')}
            value={t('{n} · dal {date}', { n: streak.days, date: formatDate(streak.start) })}
          />
        )}
        <Line
          label={t('Durata media di un ascolto')}
          value={formatDuration(summary.streams > 0 ? summary.totalMs / summary.streams : 0)}
        />
        {skipShare !== null ? (
          <Line
            label={t('Brani saltati (< {n} s)', { n: minStreamSec })}
            value={`${Math.round(skipShare * 100)}% · ${formatNumber(data.skips.skipped)}`}
          />
        ) : (
          <Text style={styles.note}>{t('I brani saltati si vedono solo con la cronologia importata da Spotify.')}</Text>
        )}
      </Card>

      {data.forgotten.length > 0 && (
        <Card title={t('Da riscoprire')}>
          <Text style={styles.note}>{t('Brani che ascoltavi spesso e che non senti da almeno 3 mesi.')}</Text>
          {data.forgotten.map((track) => (
            <Tap
              key={`${track.trackName}|${track.artist}`}
              onPress={() => openTrack(track)}
              style={styles.smallRow}
              scaleTo={0.985}
            >
              <Cover uri={track.imageUrl} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {track.trackName}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {track.artist} · {plural(track.plays, '{n} ascolto', '{n} ascolti')}
                </Text>
              </View>
              <Text style={styles.rowSub}>{formatDate(track.lastAt)}</Text>
            </Tap>
          ))}
        </Card>
      )}
    </>
  );
}

// ---------- Computations ----------

function delta(current: number, previous: number | null | undefined) {
  if (previous === null || previous === undefined || previous === 0) return null;
  return (current - previous) / previous;
}

const keyOf = (t: { trackName: string; artist: string }) => `${t.trackName.toLowerCase()}\u0000${t.artist.toLowerCase()}`;

function computeMovers(current: TrackStat[], previous: TrackStat[]) {
  const prev = new Map(previous.map((t) => [keyOf(t), t]));
  const seen = new Set<string>();
  const all: Mover[] = [];
  for (const t of current) {
    const k = keyOf(t);
    seen.add(k);
    const before = prev.get(k)?.plays ?? 0;
    all.push({ track: t, delta: t.plays - before, isNew: before === 0 });
  }
  // Songs you stopped listening to entirely in this period.
  for (const t of previous) {
    if (!seen.has(keyOf(t))) all.push({ track: { ...t, plays: 0 }, delta: -t.plays, isNew: false });
  }
  const up = all.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
  const down = all.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5);
  return { up, down };
}

function computeVariety(artists: ArtistStat[], tracks: TrackStat[], streams: number) {
  const byPlays = [...artists].sort((a, b) => b.plays - a.plays);
  const top10 = byPlays.slice(0, 10).reduce((sum, a) => sum + a.plays, 0);
  const top10Share = streams > 0 ? top10 / streams : 0;
  const oneTimers = tracks.filter((t) => t.plays === 1).length;
  // Italian keys: shown with t().
  const label =
    top10Share >= 0.7
      ? msg('Fedele ai tuoi preferiti')
      : top10Share >= 0.4
        ? msg('Equilibrato')
        : msg('Esploratore di musica nuova');
  return { top10Share, oneTimers, oneTimerShare: tracks.length > 0 ? oneTimers / tracks.length : 0, label };
}

function trendSeries(time: TimeStats, period: Period) {
  if (period === 'week' || period === 'month') {
    const n = period === 'week' ? 7 : 30;
    const days = lastDays(time, n);
    return {
      values: days.map((d) => d.ms),
      labels: days.map((d, i) =>
        n === 7
          ? weekdaysShort()[(new Date(d.date).getDay() + 6) % 7].charAt(0)
          : i % 5 === 4
            ? String(new Date(d.date).getDate())
            : '',
      ),
      highlight: n - 1,
      caption: t('Minuti al giorno negli ultimi {n} giorni', { n }),
    };
  }
  if (period === 'all') {
    const years = [...time.years.entries()].sort((a, b) => a[0] - b[0]);
    return {
      values: years.map(([, v]) => v.ms),
      labels: years.map(([y]) => `’${String(y).slice(2)}`),
      highlight: undefined,
      caption: t('Minuti all’anno'),
    };
  }
  // A calendar year: its months (only up to now for the current year).
  const values = period === 'year' ? lastMonths(time, new Date().getMonth() + 1).map((m) => m.ms) : time.months;
  return {
    values,
    labels: values.map((_, i) => monthsShort()[i].charAt(0)),
    highlight: undefined,
    caption: t('Minuti al mese'),
  };
}

// ---------- Pieces ----------

function Tile({ label, value, hint, delta: d }: { label: string; value: string; hint?: string; delta?: number | null }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.tileLabel}>{label}</Text>
      {d !== undefined && d !== null && (
        <Text
          style={[
            styles.delta,
            { color: Math.round(d * 100) === 0 ? colors.muted : d > 0 ? colors.accent : colors.danger },
          ]}
        >
          {Math.round(d * 100) === 0 ? t('= invariato') : `${d > 0 ? '▲' : '▼'} ${Math.abs(Math.round(d * 100))}%`}
        </Text>
      )}
      {hint && <Text style={styles.tileHint}>{hint}</Text>}
    </View>
  );
}

function MoverRow({ mover }: { mover: Mover }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const up = mover.delta > 0;
  const color = up ? colors.accent : colors.danger;
  return (
    <Tap onPress={() => openTrack(mover.track)} style={styles.smallRow} scaleTo={0.985}>
      <Text style={[styles.moverArrow, { color }]}>{up ? '▲' : '▼'}</Text>
      <Cover uri={mover.track.imageUrl} size={36} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {mover.track.trackName}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {mover.track.artist}
        </Text>
      </View>
      <Text style={[styles.moverDelta, { color }]}>
        {mover.isNew ? t('Nuovo') : `${up ? '+' : '−'}${Math.abs(mover.delta)}`}
      </Text>
    </Tap>
  );
}

function GenreBar({ genre, share }: { genre: string; share: number }) {
  const styles = useStyles();
  const pct = Math.min(100, Math.round(share * 100));
  return (
    <View style={styles.genre}>
      <View style={styles.genreHead}>
        <Text style={styles.rowTitle}>{genre.charAt(0).toUpperCase() + genre.slice(1)}</Text>
        <Text style={styles.rowSub}>{pct}%</Text>
      </View>
      <View style={styles.meter}>
        <View style={[styles.meterFill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <FadeIn style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </FadeIn>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  content: { ...contentColumn, padding: 16, gap: 16, paddingBottom: 40 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 40 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: '45%', backgroundColor: colors.card, borderRadius: radius.md, padding: 14 },
  tileValue: { color: colors.text, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tileLabel: { color: colors.muted, fontSize: 12, marginTop: 4 },
  tileHint: { color: colors.muted, fontSize: 10, opacity: 0.7 },
  delta: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  compareNote: { color: colors.muted, fontSize: 11, marginTop: -8 },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: 14, gap: 10 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  note: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  lineLabel: { color: colors.muted, flexShrink: 1 },
  lineValue: { color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'], textAlign: 'right' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 2 },
  smallRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  rowSub: { color: colors.muted, fontSize: 12 },
  moverArrow: { width: 14, fontSize: 12, fontWeight: '800' },
  moverDelta: { fontWeight: '800', fontVariant: ['tabular-nums'] },
  genre: { gap: 4 },
  genreHead: { flexDirection: 'row', justifyContent: 'space-between' },
  meter: { height: 8, borderRadius: 4, backgroundColor: colors.cardAlt, overflow: 'hidden' },
  meterFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 4 },
  meterLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  meterLabel: { color: colors.muted, fontSize: 11 },
  varietyTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
}));
