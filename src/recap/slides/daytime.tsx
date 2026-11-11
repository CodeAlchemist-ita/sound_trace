import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import { t } from '@/lib/i18n';
import { indexOfMax } from '@/lib/timeStats';

import { pct, type Slide } from '../helpers';
import { GrowBars, Pop, Rise } from '../motion';
import { PERSONAS } from '../personas';
import { styles } from '../styles';

/** The part of the day you listen most, with the 24 hours as bars. */
export const daytime: Slide = {
  id: 'daytime',
  colors: ['#818CF8', '#4338CA', '#1E1B4B'],
  fg: '#FFFFFF',
  render: (r, fg) => {
    const p = PERSONAS[r.partOfDay.name];
    return (
      <View style={styles.fill}>
        <Pop>
          <Ionicons name={p.icon} size={48} color={fg} />
        </Pop>
        <Text style={[styles.kicker, { color: fg, marginTop: 8 }]}>{t('Il tuo momento della giornata')}</Text>
        <Rise delay={150}>
          <Text style={[styles.big, { color: fg }]}>{t(p.title)}</Text>
          <Text style={[styles.lead, { color: fg }]}>
            {t(p.text)} {t(p.share, { percent: pct(r.partOfDay.share) })}
          </Text>
        </Rise>
        <GrowBars
          values={r.hours}
          labels={r.hours.map((_, h) => (h % 6 === 0 ? `${h}` : ''))}
          highlight={indexOfMax(r.hours)}
          fg={fg}
        />
        <Text style={[styles.foot, { color: fg }]}>{t('Ora del giorno, dalle 0 alle 23')}</Text>
      </View>
    );
  },
};
