import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Cover } from '@/components/Cover';
import { Tap } from '@/components/Tap';
import { minStreamMs, type PlayRow } from '@/lib/db';
import { formatDate, formatDuration, formatTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { makeStyles } from '@/lib/theme';

/** One listen: cover, song, time. `showDate` for lists that aren't grouped by day. */
function PlayItemBase({ play, onPress, showDate }: { play: PlayRow; onPress?: (p: PlayRow) => void; showDate?: boolean }) {
  const styles = useStyles();
  const skipped = play.source === 'import' && play.msPlayed < minStreamMs();
  const time = formatTime(play.playedAt);
  const when = showDate ? `${formatDate(play.playedAt)}, ${time}` : time;
  return (
    <Tap style={styles.row} scaleTo={0.985} onPress={onPress ? () => onPress(play) : undefined} disabled={!onPress}>
      {/* Skipped plays are dimmed (on the content: Tap animates the row's own opacity). */}
      <View style={[styles.content, skipped && styles.skipped]}>
        <Cover uri={play.imageUrl} size={40} />
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {play.trackName}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {play.artist}
          </Text>
        </View>
        <View style={styles.right}>
          <Text style={styles.time}>{when}</Text>
          <Text style={styles.sub}>
            {skipped ? t('saltata') : play.source === 'api' ? t('brano intero') : formatDuration(play.msPlayed)}
          </Text>
        </View>
      </View>
    </Tap>
  );
}

export const PlayItem = memo(PlayItemBase);

const useStyles = makeStyles((colors) => StyleSheet.create({
  row: { height: 58 },
  content: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  skipped: { opacity: 0.55 },
  info: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 15, fontWeight: '600' },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  time: { color: colors.text, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
}));
