import { Text, View } from 'react-native';

import { formatDuration, formatNumber } from '@/lib/format';
import { t } from '@/lib/i18n';

import type { Slide } from '../helpers';
import { Pop, Rise } from '../motion';
import { Cover, RankRow } from '../pieces';
import { styles } from '../styles';

/** Song of the year, then places 2–5. */
export const song: Slide = {
  id: 'song',
  colors: ['#FBBF24', '#D97706', '#451A03'],
  fg: '#FFFBEB',
  image: (r) => r.topTracks[0]?.imageUrl,
  show: (r) => r.topTracks.length > 0,
  render: (r, fg) => {
    const [top, ...rest] = r.topTracks;
    return (
      <View style={styles.fill}>
        <Text style={[styles.kicker, { color: fg }]}>{t('La tua canzone dell’anno')}</Text>
        <Pop delay={150}>
          <Cover url={top.imageUrl} size={170} fg={fg} large />
        </Pop>
        <Rise delay={350}>
          <Text style={[styles.bigSmall, { color: fg }]} numberOfLines={2}>
            {top.trackName}
          </Text>
          <Text style={[styles.title, { color: fg }]} numberOfLines={1}>
            {top.artist}
          </Text>
          <Text style={[styles.lead, { color: fg, marginTop: 6 }]}>
            {t('L’hai ascoltata {plays} volte, per {duration}.', {
              plays: formatNumber(top.plays),
              duration: formatDuration(top.totalMs),
            })}
          </Text>
        </Rise>
        <View style={styles.list}>
          {rest.map((track, i) => (
            <Rise key={`${track.trackName}|${track.artist}`} delay={700 + i * 140}>
              <RankRow
                rank={i + 2}
                title={track.trackName}
                subtitle={track.artist}
                detail={`${formatNumber(track.plays)}×`}
                fg={fg}
                imageUrl={track.imageUrl}
              />
            </Rise>
          ))}
        </View>
      </View>
    );
  },
};
