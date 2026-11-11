import { Text, View } from 'react-native';

import { t } from '@/lib/i18n';

import type { Slide } from '../helpers';
import { styles } from '../styles';

/** Shown alone when the year has no plays. */
export const empty: Slide = {
  id: 'empty',
  colors: ['#2A2E38', '#111318'],
  fg: '#F4F5F7',
  render: (r, fg) => (
    <View style={styles.center}>
      <Text style={[styles.big, { color: fg }]}>{t('Ancora niente da raccontare')}</Text>
      <Text style={[styles.lead, { color: fg }]}>
        {t(
          'Non ci sono ascolti salvati per il {year}. Importa la tua cronologia da Impostazioni per vedere il riepilogo completo.',
          { year: r.year },
        )}
      </Text>
    </View>
  ),
};
