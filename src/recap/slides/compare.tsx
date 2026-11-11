import { Text, View } from 'react-native';

import { formatNumber, msToMinutes } from '@/lib/format';
import { t } from '@/lib/i18n';

import { signedPct, type Slide } from '../helpers';
import { CompareBar, Pop, Rise } from '../motion';
import { Stat } from '../pieces';
import { styles } from '../styles';

/** This year against the same stretch of the year before. */
export const compare: Slide = {
  id: 'compare',
  colors: ['#2DD4BF', '#0F766E', '#042F2E'],
  fg: '#F0FDFA',
  show: (r) => r.previous !== null,
  render: (r, fg) => {
    const p = r.previous!;
    const delta = r.totalMs / p.totalMs - 1;
    const max = Math.max(r.totalMs, p.totalMs);
    const minutesText = (ms: number) => `${formatNumber(msToMinutes(ms))} min`;
    return (
      <View style={styles.fill}>
        <Text style={[styles.kicker, { color: fg }]}>
          {t('Rispetto al {year}', { year: p.year })}
          {r.partial ? ` ${t('(stesso periodo)')}` : ''}
        </Text>
        <Pop delay={100}>
          <Text style={[styles.mega, { color: fg }]} adjustsFontSizeToFit numberOfLines={1}>
            {signedPct(delta)}
          </Text>
        </Pop>
        <Text style={[styles.title, { color: fg }]}>
          {Math.abs(delta) < 0.005
            ? t('stessi minuti di ascolto')
            : delta > 0
              ? t('minuti di ascolto in più')
              : t('minuti di ascolto in meno')}
        </Text>
        <View style={styles.compareBars}>
          <CompareBar label={String(p.year)} value={p.totalMs / max} text={minutesText(p.totalMs)} fg={fg} dim delay={500} />
          <CompareBar label={String(r.year)} value={r.totalMs / max} text={minutesText(r.totalMs)} fg={fg} delay={700} />
        </View>
        <View style={styles.statRow}>
          <Rise delay={1100} style={{ flex: 1 }}>
            <Stat value={signedPct(r.streams / Math.max(1, p.streams) - 1)} label={t('ascolti')} fg={fg} />
          </Rise>
          <Rise delay={1250} style={{ flex: 1 }}>
            {r.hasEarlierHistory ? (
              <Stat value={formatNumber(r.newArtists)} label={t('artisti scoperti')} fg={fg} />
            ) : (
              <Stat value={signedPct(r.uniqueArtists / Math.max(1, p.uniqueArtists) - 1)} label={t('artisti diversi')} fg={fg} />
            )}
          </Rise>
        </View>
      </View>
    );
  },
};
