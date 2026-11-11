import { Text, View } from 'react-native';

import { formatDuration, formatNumber } from '@/lib/format';
import { plural, t } from '@/lib/i18n';

import type { Slide } from '../helpers';
import { Pop, Rise } from '../motion';
import { Cover, RankRow } from '../pieces';
import { styles } from '../styles';

/** Artist of the year, then places 2–5. */
export const artist: Slide = {
  id: 'artist',
  colors: ['#FB7185', '#BE123C', '#4C0519'],
  fg: '#FFFFFF',
  image: (r) => r.topArtists[0]?.imageUrl,
  show: (r) => r.topArtists.length > 0,
  render: (r, fg) => {
    const [top, ...rest] = r.topArtists;
    return (
      <View style={styles.fill}>
        <Text style={[styles.kicker, { color: fg }]}>{t('Il tuo artista dell’anno')}</Text>
        <Pop delay={150}>
          <Cover url={top.imageUrl} size={170} fg={fg} round />
        </Pop>
        <Rise delay={350}>
          <Text style={[styles.big, { color: fg }]} numberOfLines={2} adjustsFontSizeToFit>
            {top.artist}
          </Text>
          <Text style={[styles.lead, { color: fg }]}>
            {plural(
              top.tracks,
              '{duration} insieme, {plays} ascolti e {n} brano diverso.',
              '{duration} insieme, {plays} ascolti e {n} brani diversi.',
              { duration: formatDuration(top.totalMs), plays: formatNumber(top.plays) },
            )}
          </Text>
        </Rise>
        <View style={styles.list}>
          {rest.map((a, i) => (
            <Rise key={a.artist} delay={700 + i * 140}>
              <RankRow rank={i + 2} title={a.artist} detail={formatDuration(a.totalMs)} fg={fg} imageUrl={a.imageUrl} round />
            </Rise>
          ))}
        </View>
      </View>
    );
  },
};
