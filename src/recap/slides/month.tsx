import { Text, View } from 'react-native';

import { formatDuration, formatNumber } from '@/lib/format';
import { monthsLong, monthsShort, t } from '@/lib/i18n';

import { cap, type Slide } from '../helpers';
import { GrowBars, Rise } from '../motion';
import { RankRow } from '../pieces';
import { styles } from '../styles';

/** The month with the most listening, the twelve months as bars, and that month's top song. */
export const month: Slide = {
  id: 'month',
  colors: ['#34D399', '#047857', '#022C22'],
  fg: '#ECFDF5',
  render: (r, fg) => (
    <View style={styles.fill}>
      <Text style={[styles.kicker, { color: fg }]}>{t('Il tuo mese record')}</Text>
      <Rise delay={100}>
        <Text style={[styles.big, { color: fg }]}>{cap(monthsLong()[r.topMonth])}</Text>
        <Text style={[styles.lead, { color: fg }]}>
          {t('{duration} di ascolto in un solo mese.', { duration: formatDuration(r.months[r.topMonth]) })}
        </Text>
      </Rise>
      <GrowBars values={r.months} labels={monthsShort().map((m) => m.charAt(0))} highlight={r.topMonth} fg={fg} />
      {r.topMonthTrack && (
        <Rise delay={1100}>
          <Text style={[styles.foot, { color: fg, marginBottom: 6 }]}>
            {t('La colonna sonora di {month}', { month: monthsLong()[r.topMonth] })}
          </Text>
          <RankRow
            title={r.topMonthTrack.trackName}
            subtitle={r.topMonthTrack.artist}
            detail={`${formatNumber(r.topMonthTrack.plays)}×`}
            fg={fg}
            imageUrl={r.topMonthTrack.imageUrl}
          />
        </Rise>
      )}
    </View>
  ),
};
