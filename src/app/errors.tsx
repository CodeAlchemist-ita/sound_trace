import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { Tap } from '@/components/Tap';
import { askConfirm, showMessage } from '@/lib/dialog';
import { clearErrorLog, formatErrorLog, getErrorLog, onErrorLogged, type ErrorEntry } from '@/lib/errorLog';
import { formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';
import { shareText } from '@/lib/shareText';
import { contentColumn, makeStyles, radius, useTheme } from '@/lib/theme';

/** The local error log (Settings → Diagnostica): read it, share it, clear it. */
export default function ErrorsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const [entries, setEntries] = useState<ErrorEntry[] | null>(null);

  const load = useCallback(() => {
    // Newest first.
    getErrorLog().then((log) => setEntries([...log].reverse()));
  }, []);

  useEffect(() => {
    load();
    return onErrorLogged(load);
  }, [load]);

  async function onShare() {
    try {
      await shareText('spotify-stats-errors.txt', formatErrorLog(await getErrorLog()), t('Condividi il registro errori'));
    } catch (e) {
      showMessage(t('Errore'), e instanceof Error ? e.message : String(e));
    }
  }

  async function onClear() {
    if (await askConfirm(t('Svuota registro'), t('Eliminare tutti gli errori registrati?'), t('Svuota'), true)) {
      await clearErrorLog();
    }
  }

  const empty = entries !== null && entries.length === 0;

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      data={entries ?? []}
      keyExtractor={(e, i) => `${e.at}|${i}`}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.text}>
            {t('Gli ultimi errori dell’app, dal più recente. Token ed email vengono oscurati. Il registro resta su questo dispositivo finché non lo condividi tu.')}
          </Text>
          {!empty && (
            <View style={styles.actions}>
              <Tap onPress={onShare} style={[styles.button, { backgroundColor: colors.accent }]} accessibilityRole="button">
                <Text style={[styles.buttonText, { color: colors.onAccent }]}>{t('Condividi')}</Text>
              </Tap>
              <Tap onPress={onClear} style={[styles.button, { backgroundColor: colors.cardAlt }]} accessibilityRole="button">
                <Text style={[styles.buttonText, { color: colors.danger }]}>{t('Svuota')}</Text>
              </Tap>
            </View>
          )}
        </View>
      }
      ListEmptyComponent={empty ? <Text style={styles.empty}>{t('Nessun errore registrato.')}</Text> : undefined}
      renderItem={({ item }) => (
        <View style={styles.entry}>
          <View style={styles.entryHead}>
            <Text style={styles.source}>
              {item.source}
              {item.count > 1 ? ` ×${item.count}` : ''}
            </Text>
            <Text style={styles.date}>{formatDateTime(item.at)}</Text>
          </View>
          <Text style={styles.message} selectable>
            {item.message}
          </Text>
          {item.stack && (
            <Text style={styles.stack} numberOfLines={6} selectable>
              {item.stack}
            </Text>
          )}
        </View>
      )}
    />
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    content: { ...contentColumn, padding: 16, gap: 10, paddingBottom: 32 },
    header: { gap: 12, marginBottom: 4 },
    text: { color: colors.muted, lineHeight: 20 },
    actions: { flexDirection: 'row', gap: 10 },
    button: { flex: 1, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
    buttonText: { fontWeight: '700', fontSize: 15 },
    empty: { color: colors.muted, textAlign: 'center', paddingVertical: 32 },
    entry: { backgroundColor: colors.card, borderRadius: radius.md, padding: 12, gap: 6 },
    entryHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    source: { color: colors.warn, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
    date: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
    message: { color: colors.text, fontSize: 14, lineHeight: 19 },
    stack: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  }),
);
