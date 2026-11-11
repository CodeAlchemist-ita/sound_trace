import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import { formatNumber } from '@/lib/format';
import { t } from '@/lib/i18n';

import { pct, withAlpha, type Slide } from '../helpers';
import { Meter, Pop, Rise } from '../motion';
import { PERSONALITIES } from '../personas';
import { styles } from '../styles';

/** What kind of listener you are, with the three gauges behind the verdict. */
export const personality: Slide = {
  id: 'personality',
  colors: ['#F472B6', '#BE185D', '#500724'],
  fg: '#FFFFFF',
  render: (r, fg) => {
    const p = PERSONALITIES[r.personality];
    const repeat = r.streams / Math.max(1, r.uniqueTracks);
    return (
      <View style={styles.fill}>
        <Pop>
          <View style={[styles.badge, { backgroundColor: withAlpha(fg, 0.16) }]}>
            <Ionicons name={p.icon} size={40} color={fg} />
          </View>
        </Pop>
        <Text style={[styles.kicker, { color: fg, marginTop: 8 }]}>{t('Che tipo di ascoltatore sei')}</Text>
        <Rise delay={150}>
          <Text style={[styles.big, { color: fg }]}>{t(p.title)}</Text>
          <Text style={[styles.lead, { color: fg }]}>{p.text(r)}</Text>
        </Rise>
        <View style={styles.meters}>
          <Meter label={t('Fedeltà ai tuoi top 5')} value={r.top5Share} text={pct(r.top5Share)} fg={fg} delay={600} />
          {r.hasEarlierHistory && (
            <Meter
              label={t('Artisti nuovi per te')}
              value={r.newArtists / Math.max(1, r.uniqueArtists)}
              text={formatNumber(r.newArtists)}
              fg={fg}
              delay={800}
            />
          )}
          <Meter label={t('Ascolti per brano')} value={Math.min(1, repeat / 10)} text={`${formatNumber(repeat)}×`} fg={fg} delay={1000} />
        </View>
      </View>
    );
  },
};
