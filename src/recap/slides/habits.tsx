import { Text, View } from 'react-native';

import { formatDuration, formatNumber } from '@/lib/format';
import { plural, t } from '@/lib/i18n';

import { cap, onDate, type Slide } from '../helpers';
import { CountUp, Rise } from '../motion';
import { Stat } from '../pieces';
import { styles } from '../styles';

/** Longest streak of days with music, days listened and the record day. */
export const habits: Slide = {
  id: 'habits',
  colors: ['#FB923C', '#C2410C', '#431407'],
  fg: '#FFFFFF',
  render: (r, fg) => (
    <View style={styles.center}>
      <Text style={[styles.kicker, { color: fg }]}>{t('Le tue abitudini')}</Text>
      {r.longestStreak && (
        <>
          <CountUp value={r.longestStreak.days} style={[styles.mega, { color: fg }]} duration={1000} />
          <Text style={[styles.title, { color: fg }]}>
            {plural(r.longestStreak.days, 'giorno con la musica', 'giorni di fila con la musica')}
          </Text>
          <Rise delay={700}>
            <Text style={[styles.lead, { color: fg }]}>
              {cap(onDate(r.longestStreak.start, 'dal'))} {onDate(r.longestStreak.end, 'al')}
            </Text>
          </Rise>
        </>
      )}
      <View style={styles.statPair}>
        <Rise delay={1000}>
          <Stat
            value={`${formatNumber(r.daysListened)}/${formatNumber(r.daysInPeriod)}`}
            label={t('giorni con almeno un ascolto')}
            fg={fg}
          />
        </Rise>
        {r.topDay && (
          <Rise delay={1150}>
            <Stat
              value={formatDuration(r.topDay.ms)}
              label={t('{date}, il tuo giorno record', { date: cap(onDate(r.topDay.date)) })}
              fg={fg}
            />
          </Rise>
        )}
      </View>
    </View>
  ),
};
