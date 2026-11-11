import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Cover } from '@/components/Cover';
import { Tap } from '@/components/Tap';
import type { ArtistStat } from '@/lib/db';
import { formatDuration, formatNumber } from '@/lib/format';
import { plural } from '@/lib/i18n';
import { makeStyles } from '@/lib/theme';

type Props = { rank: number; artist: ArtistStat; onPress?: (a: ArtistStat) => void };

function ArtistRowBase({ rank, artist, onPress }: Props) {
  const styles = useStyles();
  return (
    <Tap style={styles.row} scaleTo={0.985} onPress={onPress ? () => onPress(artist) : undefined} disabled={!onPress}>
      <Text style={styles.rank}>{rank}</Text>
      <Cover uri={artist.imageUrl} round />
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {artist.artist}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {plural(artist.tracks, '{n} brano', '{n} brani')}
        </Text>
      </View>
      <View style={styles.stats}>
        <Text style={styles.plays}>
          {formatNumber(artist.plays)} <Text style={styles.unit}>{plural(artist.plays, 'ascolto', 'ascolti')}</Text>
        </Text>
        <Text style={styles.sub}>{formatDuration(artist.totalMs)}</Text>
      </View>
    </Tap>
  );
}

export const ArtistRow = memo(
  ArtistRowBase,
  (a, b) =>
    a.rank === b.rank &&
    a.onPress === b.onPress &&
    a.artist.artist === b.artist.artist &&
    a.artist.plays === b.artist.plays &&
    a.artist.totalMs === b.artist.totalMs &&
    a.artist.imageUrl === b.artist.imageUrl,
);

const useStyles = makeStyles((colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', height: 64, gap: 12 },
  rank: { color: colors.muted, width: 28, textAlign: 'right', fontVariant: ['tabular-nums'], fontWeight: '600' },
  info: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 15, fontWeight: '600' },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2, fontVariant: ['tabular-nums'] },
  stats: { alignItems: 'flex-end' },
  plays: { color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  unit: { color: colors.muted, fontWeight: '400', fontSize: 12 },
}));
