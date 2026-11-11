import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Tap } from '@/components/Tap';
import { hapticSuccess } from '@/lib/haptics';
import { getMeta, setMeta } from '@/lib/db';
import { t } from '@/lib/i18n';
import { formatNumber } from '@/lib/format';
import { makeStyles, radius, useTheme } from '@/lib/theme';

/**
 * Where the year is heading at the current pace, and progress towards a goal
 * the user sets (minutes, stored per year).
 */
export function YearGoal({ year, minutes }: { year: number; minutes: number }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const key = `yearGoal:${year}`;
  const [goal, setGoal] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    getMeta(key).then((v) => setGoal(v ? Number(v) : null));
  }, [key]);

  const now = new Date();
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
  // In the first days of January the pace says little.
  const projection = elapsed > 0.02 ? Math.round(minutes / elapsed) : null;
  const progress = goal ? Math.min(1, minutes / goal) : 0;
  const onTrack = goal && projection !== null ? projection >= goal : null;

  async function save() {
    const value = Math.round(Number(draft.replace(/\D/g, '')));
    if (value > 0) {
      await setMeta(key, String(value));
      setGoal(value);
      hapticSuccess();
    }
    setEditing(false);
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{t('Obiettivo {year}', { year })}</Text>
        {!editing && (
          <Tap
            onPress={() => {
              setDraft(goal ? String(goal) : projection ? String(Math.round(projection / 1000) * 1000) : '');
              setEditing(true);
            }}
            hitSlop={8}
          >
            <Text style={styles.link}>{goal ? t('Modifica') : t('Imposta')}</Text>
          </Tap>
        )}
      </View>

      {editing ? (
        <View style={styles.editRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={save}
            keyboardType="number-pad"
            placeholder={t('Minuti, es. 50000')}
            placeholderTextColor={colors.muted}
            style={styles.input}
            autoFocus
          />
          <Tap onPress={save} style={styles.save}>
            <Text style={styles.saveText}>{t('Salva')}</Text>
          </Tap>
        </View>
      ) : goal ? (
        <>
          <Text style={styles.big}>
            {formatNumber(minutes)} <Text style={styles.of}>/ {formatNumber(goal)} min</Text>
          </Text>
          <View style={styles.bar}>
            <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
            {/* Where you should be today to reach the goal on Dec 31st. */}
            <View style={[styles.marker, { left: `${Math.round(elapsed * 100)}%` }]} />
          </View>
          <Text style={styles.note}>
            {progress >= 1
              ? t('Obiettivo raggiunto! 🎉')
              : `${t('{percent}% fatto.', { percent: Math.round(progress * 100) })} ` +
                (onTrack === null
                  ? ''
                  : onTrack
                    ? t('Sei in linea per raggiungerlo.')
                    : t('Ti mancano circa {n} minuti al giorno da qui a fine anno.', {
                        n: formatNumber(Math.ceil((goal - minutes) / Math.max(1, (end - now.getTime()) / 86_400_000))),
                      }))}
          </Text>
        </>
      ) : (
        <Text style={styles.note}>{t('Imposta quanti minuti vuoi ascoltare quest’anno e segui i tuoi progressi.')}</Text>
      )}

      {projection !== null && !editing && (
        <Text style={styles.projection}>
          {t('A questo ritmo chiuderai il {year} con circa', { year })}{' '}
          <Text style={styles.strong}>{t('{n} minuti', { n: formatNumber(projection) })}</Text>.
        </Text>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: 14, gap: 8 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  link: { color: colors.accent, fontWeight: '700' },
  big: { color: colors.text, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  of: { color: colors.muted, fontSize: 15, fontWeight: '600' },
  bar: { height: 10, borderRadius: 5, backgroundColor: colors.cardAlt, overflow: 'visible', justifyContent: 'center' },
  fill: { height: '100%', borderRadius: 5, backgroundColor: colors.accent },
  marker: { position: 'absolute', width: 2, height: 16, backgroundColor: colors.text, opacity: 0.7, marginLeft: -1 },
  note: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  projection: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  strong: { color: colors.text, fontWeight: '700' },
  editRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: colors.cardAlt,
    color: colors.text,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  save: { backgroundColor: colors.accent, borderRadius: radius.sm, paddingHorizontal: 16, justifyContent: 'center' },
  saveText: { color: colors.onAccent, fontWeight: '800' },
}));
