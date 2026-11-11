import { Text, View } from 'react-native';

import { t } from '@/lib/i18n';

import { cap, formatClock, onDate, type Slide } from '../helpers';
import { Pop, Rise } from '../motion';
import { Cover } from '../pieces';
import { styles } from '../styles';

/** The first song of the year. */
export const first: Slide = {
  id: 'first',
  colors: ['#38BDF8', '#0369A1', '#082F49'],
  fg: '#FFFFFF',
  image: (r) => r.firstPlay?.imageUrl,
  show: (r) => !!r.firstPlay,
  render: (r, fg) =>
    r.firstPlay && (
      <View style={styles.center}>
        <Text style={[styles.kicker, { color: fg }]}>{t('Il tuo anno è cominciato con')}</Text>
        <Pop delay={200}>
          <Cover url={r.firstPlay.imageUrl} size={200} fg={fg} large />
        </Pop>
        <Rise delay={450}>
          <Text style={[styles.big, { color: fg }]} numberOfLines={3}>
            {r.firstPlay.trackName}
          </Text>
          <Text style={[styles.title, { color: fg }]}>{r.firstPlay.artist}</Text>
        </Rise>
        <Rise delay={700}>
          <Text style={[styles.lead, { color: fg }]}>
            {t('{date}, alle {time}.', { date: cap(onDate(r.firstPlay.playedAt)), time: formatClock(r.firstPlay.playedAt) })}
          </Text>
        </Rise>
      </View>
    ),
};
