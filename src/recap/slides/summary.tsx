import { Text, View } from 'react-native';

import { formatNumber, msToMinutes } from '@/lib/format';
import { monthsLong, t } from '@/lib/i18n';
import { darkColors } from '@/lib/theme';

import { cap, type Slide } from '../helpers';
import { PERSONALITIES } from '../personas';
import { Collage, SummaryCell } from '../pieces';
import { styles } from '../styles';

/** The last story: the year in six numbers, made to be shared as a picture. */
export const summary: Slide = {
  id: 'summary',
  colors: ['#27272A', '#111113', '#000000'],
  fg: '#F4F5F7',
  render: (r, fg) => (
    <View style={styles.fill}>
      <Text style={[styles.kicker, { color: darkColors.accent }]}>{t('Il tuo {year} in breve', { year: r.year })}</Text>
      <Collage urls={r.topTracks.map((track) => track.imageUrl)} fg={fg} />
      <View style={styles.summaryGrid}>
        <SummaryCell label={t('Minuti')} value={formatNumber(msToMinutes(r.totalMs))} fg={fg} />
        <SummaryCell label={t('Ascolti')} value={formatNumber(r.streams)} fg={fg} />
        <SummaryCell label={t('Artista top')} value={r.topArtists[0]?.artist ?? '—'} fg={fg} />
        <SummaryCell label={t('Canzone top')} value={r.topTracks[0]?.trackName ?? '—'} fg={fg} />
        <SummaryCell label={t('Mese top')} value={cap(monthsLong()[r.topMonth])} fg={fg} />
        <SummaryCell label={t('Profilo')} value={t(PERSONALITIES[r.personality].title)} fg={fg} />
      </View>
    </View>
  ),
};
