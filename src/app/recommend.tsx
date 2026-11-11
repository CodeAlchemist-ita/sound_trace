import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Cover } from '@/components/Cover';
import { FadeIn } from '@/components/FadeIn';
import { Tap } from '@/components/Tap';
import { showMessage } from '@/lib/dialog';
import { displayName, listFriends, sendRecommendation, type Friend, type RecommendResult } from '@/lib/friends';
import { hapticError, hapticSuccess } from '@/lib/haptics';
import { plural, t } from '@/lib/i18n';
import { MAX_MESSAGE } from '@/lib/recommend';
import { contentColumn, makeStyles, radius, useTheme } from '@/lib/theme';

/** Why a friend didn't get the recommendation, in plain words. */
function skippedText(skipped: RecommendResult['skipped'], friends: Friend[]) {
  const nameOf = (id: string) => {
    const f = friends.find((x) => x.id === id);
    return f ? displayName(f) : t('Un amico');
  };
  return skipped
    .map((s) => {
      const name = nameOf(s.friendId);
      if (s.reason === 'disabled') return t('{name} non riceve consigli.', { name });
      if (s.reason === 'duplicate') return t('Avevi già consigliato questo brano a {name}.', { name });
      return t('{name} non è più tra i tuoi amici.', { name });
    })
    .join('\n');
}

/** Pick friends and an optional message to recommend a song. */
export default function RecommendScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ track: string; artist: string; uri?: string; image?: string }>();
  const track = params.track ?? '';
  const artist = params.artist ?? '';
  const uri = params.uri || null;
  const image = params.image || null;

  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listFriends()
      .then((l) => !cancelled && setFriends(l.friends))
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  async function onSend() {
    setSending(true);
    try {
      const result = await sendRecommendation({
        friendIds: selected,
        trackName: track,
        artist,
        trackUri: uri,
        imageUrl: image,
        message: message.trim(),
      });
      const why = result.skipped.length > 0 ? skippedText(result.skipped, friends ?? []) : '';
      if (result.sent === 0) {
        // Nothing went out: stay here so the user can pick someone else.
        hapticError();
        showMessage(t('Consiglio non inviato'), why);
        return;
      }
      hapticSuccess();
      const done = plural(result.sent, 'Consiglio inviato a {n} amico.', 'Consiglio inviato a {n} amici.');
      showMessage(t('Consiglio inviato'), why ? `${done}\n${why}` : done);
      router.back();
    } catch (e) {
      hapticError();
      showMessage(t('Errore'), e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  const canSend = selected.length > 0 && !sending;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <FadeIn style={styles.song}>
        <Cover uri={image} size={64} />
        <View style={styles.info}>
          <Text style={styles.songTitle} numberOfLines={2}>
            {track}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {artist}
          </Text>
        </View>
      </FadeIn>

      {loadError && <Text style={styles.error}>{loadError}</Text>}
      {!friends && !loadError && <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />}

      {friends && friends.length === 0 && (
        <Text style={styles.empty}>{t('Non hai ancora amici a cui consigliare un brano. Aggiungili dalla scheda Amici.')}</Text>
      )}

      {friends && friends.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('A chi lo consigli?')}</Text>
          <View style={styles.card}>
            {friends.map((f) => {
              const on = selected.includes(f.id);
              return (
                <Tap
                  key={f.id}
                  onPress={() => toggle(f.id)}
                  disabled={sending}
                  style={styles.row}
                  scaleTo={0.985}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={displayName(f)}
                >
                  <Avatar uri={f.avatar} name={displayName(f)} size={40} />
                  <Text style={styles.name} numberOfLines={1}>
                    {displayName(f)}
                  </Text>
                  <View style={[styles.box, on && styles.boxOn]}>
                    {on && <Ionicons name="checkmark" size={16} color={colors.onAccent} />}
                  </View>
                </Tap>
              );
            })}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('Messaggio (facoltativo)')}</Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder={t('Scrivi due righe per il tuo amico…')}
              placeholderTextColor={colors.muted}
              style={styles.input}
              multiline
              maxLength={MAX_MESSAGE}
              editable={!sending}
            />
            <Text style={styles.counter}>{`${message.length}/${MAX_MESSAGE}`}</Text>
          </View>

          <Tap onPress={onSend} disabled={!canSend} dimmed={!canSend} style={styles.sendBtn} accessibilityRole="button">
            {sending ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.sendText}>{t('Invia consiglio')}</Text>}
          </Tap>
        </View>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  content: { ...contentColumn, padding: 16, paddingBottom: 40, gap: 20 },
  song: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.card, borderRadius: radius.lg, padding: 14 },
  info: { flex: 1, minWidth: 0 },
  songTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  sub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  section: { gap: 12 },
  sectionTitle: { color: colors.muted, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, gap: 12 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  name: { flex: 1, minWidth: 0, color: colors.text, fontSize: 15, fontWeight: '600' },
  box: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  input: {
    backgroundColor: colors.cardAlt,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 84,
    textAlignVertical: 'top',
  },
  counter: { color: colors.muted, fontSize: 12, textAlign: 'right' },
  sendBtn: { backgroundColor: colors.accent, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  sendText: { color: colors.onAccent, fontSize: 16, fontWeight: '800' },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 8, lineHeight: 20 },
  error: { color: colors.danger, textAlign: 'center' },
}));
