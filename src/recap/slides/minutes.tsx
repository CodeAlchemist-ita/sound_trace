import { Text, View } from 'react-native';

import { formatNumber, msToMinutes } from '@/lib/format';
import { t } from '@/lib/i18n';

import { formatDays, type Slide } from '../helpers';
import { CountUp, Rise } from '../motion';
import { Stat } from '../pieces';
import { styles } from '../styles';

/** Total minutes of the year, counted up from zero. */
export const minutes: Slide = {
  id: 'minutes',
  colors: ['#A855F7', '#6D28D9', '#2E1065'],
  fg: '#FFFFFF',
  render: (r, fg) => (
    <View style={styles.center}>
      <Text style={[styles.kicker, { color: fg }]}>{t('Hai ascoltato')}</Text>
      <CountUp value={msToMinutes(r.totalMs)} style={[styles.mega, { color: fg }]} />
      <Text style={[styles.title, { color: fg }]}>{t('minuti di musica')}</Text>
      <Rise delay={900}>
        <Text style={[styles.lead, { color: fg }]}>
          {t('Equivalgono a {time} di musica senza pause.', { time: formatDays(r.totalMs) })}
        </Text>
      </Rise>
      <View style={styles.statRow}>
        <Rise delay={1200} style={{ flex: 1 }}>
          <Stat value={formatNumber(r.streams)} label={t('ascolti')} fg={fg} />
        </Rise>
        <Rise delay={1350} style={{ flex: 1 }}>
          <Stat value={formatNumber(msToMinutes(r.totalMs) / r.daysInPeriod)} label={t('minuti al giorno')} fg={fg} />
        </Rise>
      </View>
    </View>
  ),
};
