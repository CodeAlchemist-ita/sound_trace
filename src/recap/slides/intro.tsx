import { Text, View } from 'react-native';

import { t } from '@/lib/i18n';

import type { Slide } from '../helpers';
import { Rise } from '../motion';
import { styles } from '../styles';

/** The opening story: the year, and how to move between stories. */
export const intro: Slide = {
  id: 'intro',
  colors: ['#22C55E', '#15803D', '#052E16'],
  fg: '#F0FDF4',
  render: (r, fg) => (
    <View style={styles.center}>
      <Rise>
        <Text style={[styles.kicker, { color: fg }]}>{t('Riepilogo dell’anno')}</Text>
      </Rise>
      <Rise delay={150}>
        <Text style={[styles.mega, styles.megaXL, { color: fg }]}>{r.year}</Text>
      </Rise>
      <Rise delay={350}>
        <Text style={[styles.lead, { color: fg }]}>
          {r.partial
            ? t('Ecco com’è andato il tuo anno in musica, fino a oggi.')
            : t('Ecco com’è andato il tuo anno in musica.')}
        </Text>
      </Rise>
      <Rise delay={700}>
        <Text style={[styles.hint, { color: fg }]}>{t('Tocca per andare avanti · tieni premuto per fermare')}</Text>
      </Rise>
    </View>
  ),
};
