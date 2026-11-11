import { Image } from 'expo-image';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Tap } from '@/components/Tap';
import type { TrackStat } from '@/lib/db';
import { formatDuration, formatNumber } from '@/lib/format';
import { plural } from '@/lib/i18n';
import { makeStyles, useTheme } from '@/lib/theme';

export const TRACK_ROW_HEIGHT = 64;

type Props = { rank: number; track: TrackStat; onPress?: (track: TrackStat) => void };

function TrackRowBase({ rank, track, onPress }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Tap style={styles.row} scaleTo={0.985} onPress={onPress ? () => onPress(track) : undefined} disabled={!onPress}>
      <Text style={styles.rank}>{rank}</Text>
      {track.imageUrl ? (
        // expo-image caches covers on disk and in memory.
        <Image source={track.imageUrl} style={styles.cover} cachePolicy="memory-disk" recyclingKey={track.imageUrl} transition={120} />
      ) : (
        <View style={[styles.cover, styles.coverPlaceholder]}>
          <Text style={{ color: colors.muted }}>♪</Text>
        </View>
      )}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {track.trackName}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {track.artist}
        </Text>
      </View>
      <View style={styles.stats}>
        <Text style={styles.plays}>
          {formatNumber(track.plays)} <Text style={styles.playsUnit}>{plural(track.plays, 'ascolto', 'ascolti')}</Text>
        </Text>
        <Text style={styles.time}>{formatDuration(track.totalMs)}</Text>
      </View>
    </Tap>
  );
}

// Rows only re-render when their own data changes.
export const TrackRow = memo(
  TrackRowBase,
  (a, b) =>
    a.rank === b.rank &&
    a.onPress === b.onPress &&
    a.track.plays === b.track.plays &&
    a.track.totalMs === b.track.totalMs &&
    a.track.imageUrl === b.track.imageUrl &&
    a.track.trackName === b.track.trackName &&
    a.track.artist === b.track.artist,
);

const useStyles = makeStyles((colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', height: TRACK_ROW_HEIGHT, gap: 12 },

  rank: { color: colors.muted, width: 28, textAlign: 'right', fontVariant: ['tabular-nums'], fontWeight: '600' },
  cover: { width: 44, height: 44, borderRadius: 6 },
  coverPlaceholder: { backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 15, fontWeight: '600' },
  artist: { color: colors.muted, fontSize: 13, marginTop: 2 },
  stats: { alignItems: 'flex-end' },
  plays: { color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  playsUnit: { color: colors.muted, fontWeight: '400', fontSize: 12 },
  time: { color: colors.muted, fontSize: 12, marginTop: 2, fontVariant: ['tabular-nums'] },
}));
