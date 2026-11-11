import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Cover } from '@/components/Cover';
import { Equalizer } from '@/components/Equalizer';
import { FadeIn } from '@/components/FadeIn';
import { Tap } from '@/components/Tap';
import { askConfirm, showMessage } from '@/lib/dialog';
import { formatDateTime } from '@/lib/format';
import {
  deleteRecommendation,
  displayName,
  friendsEnabled,
  getFriendsNowPlaying,
  getRecommendations,
  listFriends,
  markRecommendationsSeen,
  removeFriend,
  respondToRequest,
  sendFriendRequest,
  type FriendNowPlaying,
  type FriendsList,
  type Person,
  type Recommendation,
  type RecommendationsList,
} from '@/lib/friends';
import { hapticError, hapticSuccess } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { setUnseen, spotifyTrackUrl } from '@/lib/recommend';
import { contentColumn, makeStyles, radius, useTheme } from '@/lib/theme';

/** Sent recommendations shown before "Mostra tutti". */
const SENT_PREVIEW = 5;

export default function FriendsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const [data, setData] = useState<FriendsList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  // Request id / friend id with an action in progress, to disable its buttons.
  const [busy, setBusy] = useState<string | null>(null);
  // What each friend is playing right now, by friend id.
  const [playing, setPlaying] = useState<Record<string, FriendNowPlaying>>({});
  const [recs, setRecs] = useState<RecommendationsList | null>(null);
  const [showAllSent, setShowAllSent] = useState(false);

  const load = useCallback(async () => {
    if (!friendsEnabled) return;
    try {
      // Recommendations are a bonus: if they fail the friends list still loads.
      const [list, recommendations] = await Promise.all([listFriends(), getRecommendations().catch(() => null)]);
      setData(list);
      setError(null);
      if (recommendations) {
        setRecs(recommendations);
        // The received ones are on screen now: the server forgets they were new, and so does the tab badge.
        if (recommendations.unseen > 0) {
          setUnseen(0);
          markRecommendationsSeen().catch(() => undefined);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Requests arrive from other people: reload every time the tab is opened. While it
  // stays open, check twice a minute what friends are listening to.
  useFocusEffect(
    useCallback(() => {
      if (!friendsEnabled) return;
      let cancelled = false;
      const loadPlaying = () => getFriendsNowPlaying().then((now) => !cancelled && setPlaying(now));
      load();
      loadPlaying();
      const timer = setInterval(loadPlaying, 30_000);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([load(), getFriendsNowPlaying().then(setPlaying)]);
    setRefreshing(false);
  }

  async function onSend() {
    setSending(true);
    try {
      const status = await sendFriendRequest(email);
      setEmail('');
      hapticSuccess();
      showMessage(
        status === 'accepted' ? t('Ora siete amici') : t('Richiesta inviata'),
        status === 'accepted'
          ? t('Questa persona ti aveva già chiesto l’amicizia: ora potete vedere i rispettivi profili.')
          : t('Quando accetterà, la vedrai tra i tuoi amici.'),
      );
      await load();
    } catch (e) {
      hapticError();
      showMessage(t('Richiesta non inviata'), e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    try {
      await action();
      await load();
    } catch (e) {
      showMessage(t('Errore'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onCancel(p: Person) {
    const question = t('Annullare la richiesta a {name}?', { name: displayName(p) });
    if (await askConfirm(t('Annulla richiesta'), question, t('Annulla richiesta'), true)) {
      run(p.id, () => removeFriend(p.id));
    }
  }

  async function onRemoveRecommendation(r: Recommendation) {
    const question = t('Rimuovere «{track}» dai consigli?', { track: r.trackName });
    if (!(await askConfirm(t('Rimuovi consiglio'), question, t('Rimuovi'), true))) return;
    run(`rec${r.id}`, () => deleteRecommendation(r.id));
  }

  if (!friendsEnabled) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>{t('Gli amici richiedono la sincronizzazione online (Supabase). Vedi il README.')}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      <FadeIn style={styles.card}>
        <Text style={styles.cardTitle}>{t('Aggiungi un amico')}</Text>
        <Text style={styles.hint}>{t('Scrivi l’email con cui si è registrato nell’app (quella del suo account Spotify).')}</Text>
        <View style={styles.addRow}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder={t('email@esempio.com')}
            placeholderTextColor={colors.muted}
            style={styles.input}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            returnKeyType="send"
            onSubmitEditing={onSend}
            editable={!sending}
          />
          <Tap
            onPress={onSend}
            disabled={sending || !email.trim()}
            dimmed={!email.trim()}
            style={styles.sendBtn}
            accessibilityRole="button"
          >
            {sending ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.sendText}>{t('Invia')}</Text>}
          </Tap>
        </View>
      </FadeIn>

      {error && <Text style={styles.error}>{error}</Text>}
      {!data && !error && <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />}

      {data && data.incoming.length > 0 && (
        <Section title={t('Richieste ricevute ({n})', { n: data.incoming.length })}>
          {data.incoming.map((r) => (
            <PersonRow key={r.requestId} person={r.person}>
              <SmallButton
                label={t('Rifiuta')}
                disabled={busy !== null}
                onPress={() => run(String(r.requestId), () => respondToRequest(r.requestId, false))}
              />
              <SmallButton
                label={t('Accetta')}
                primary
                loading={busy === String(r.requestId)}
                disabled={busy !== null}
                onPress={() => run(String(r.requestId), () => respondToRequest(r.requestId, true))}
              />
            </PersonRow>
          ))}
        </Section>
      )}

      {recs && recs.received.length > 0 && (
        <Section title={t('Consigliati per te')}>
          {recs.received.map((r) => (
            <Tap
              key={r.id}
              onPress={() => Linking.openURL(spotifyTrackUrl(r.trackUri, r.trackName, r.artist)).catch(() => undefined)}
              style={styles.row}
              scaleTo={0.985}
              accessibilityRole="link"
            >
              <Cover uri={r.imageUrl} size={48} />
              <View style={styles.info}>
                <View style={styles.titleLine}>
                  <Text style={[styles.name, styles.shrink]} numberOfLines={1}>
                    {r.trackName}
                  </Text>
                  {!r.seen && <Text style={styles.newBadge}>{t('Nuovo')}</Text>}
                </View>
                <Text style={styles.sub} numberOfLines={1}>
                  {r.artist}
                </Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {t('da {name} · {date}', { name: displayName(r.person), date: formatDateTime(r.createdAt) })}
                </Text>
                {r.message ? <Text style={styles.quote}>{`“${r.message}”`}</Text> : null}
              </View>
              <SmallButton
                label={t('Rimuovi')}
                loading={busy === `rec${r.id}`}
                disabled={busy !== null}
                onPress={() => onRemoveRecommendation(r)}
              />
            </Tap>
          ))}
        </Section>
      )}

      {data && (
        <Section title={t('Amici')}>
          {data.friends.length === 0 ? (
            <Text style={styles.empty}>{t('Non hai ancora amici. Invia una richiesta con la loro email.')}</Text>
          ) : (
            data.friends.map((f) => (
              <PersonRow
                key={f.id}
                person={f}
                playing={playing[f.id]}
                onPress={() => router.push({ pathname: '/friend', params: { id: f.id, name: displayName(f) } })}
              >
                <Text style={styles.chevron}>›</Text>
              </PersonRow>
            ))
          )}
        </Section>
      )}

      {recs && recs.sent.length > 0 && (
        <Section title={t('I tuoi consigli')}>
          {(showAllSent ? recs.sent : recs.sent.slice(0, SENT_PREVIEW)).map((r) => (
            <View key={r.id} style={styles.row}>
              <Cover uri={r.imageUrl} size={40} />
              <View style={styles.info}>
                <Text style={styles.name} numberOfLines={1}>
                  {r.trackName}
                </Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {t('a {name}', { name: displayName(r.person) })} · {r.artist}
                </Text>
                <Text style={r.listenedAt ? styles.listened : styles.sub}>
                  {r.listenedAt ? t('ascoltato ✓') : t('non ancora ascoltato')}
                </Text>
              </View>
            </View>
          ))}
          {recs.sent.length > SENT_PREVIEW && (
            <Tap onPress={() => setShowAllSent((v) => !v)} style={styles.more} accessibilityRole="button">
              <Text style={styles.moreText}>
                {showAllSent ? t('Mostra meno') : t('Mostra tutti ({n})', { n: recs.sent.length })}
              </Text>
            </Tap>
          )}
        </Section>
      )}

      {data && data.outgoing.length > 0 && (
        <Section title={t('Richieste inviate')}>
          {data.outgoing.map((r) => (
            <PersonRow key={r.requestId} person={r.person} subtitle={t('In attesa di risposta')}>
              <SmallButton
                label={t('Annulla')}
                loading={busy === r.person.id}
                disabled={busy !== null}
                onPress={() => onCancel(r.person)}
              />
            </PersonRow>
          ))}
        </Section>
      )}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function PersonRow(props: {
  person: Person;
  subtitle?: string;
  /** Shown instead of the email while this friend is listening to something. */
  playing?: FriendNowPlaying;
  onPress?: () => void;
  children?: ReactNode;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const name = displayName(props.person);
  return (
    <Tap onPress={props.onPress} disabled={!props.onPress} style={styles.row} scaleTo={0.985}>
      <Avatar uri={props.person.avatar} name={name} />
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        {props.playing ? (
          <View style={styles.playing}>
            <Equalizer color={colors.accent} size={11} />
            <Text style={styles.playingText} numberOfLines={1}>
              {props.playing.trackName} · {props.playing.artist}
            </Text>
          </View>
        ) : (
          <Text style={styles.sub} numberOfLines={1}>
            {props.subtitle ?? props.person.email}
          </Text>
        )}
      </View>
      {props.children}
    </Tap>
  );
}

function SmallButton(props: { label: string; onPress: () => void; primary?: boolean; loading?: boolean; disabled?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const fg = props.primary ? colors.onAccent : colors.text;
  return (
    <Tap
      onPress={props.onPress}
      disabled={props.disabled}
      dimmed={props.disabled}
      hitSlop={4}
      accessibilityRole="button"
      style={[styles.smallBtn, { backgroundColor: props.primary ? colors.accent : colors.cardAlt }]}
    >
      {props.loading ? <ActivityIndicator size="small" color={fg} /> : <Text style={[styles.smallText, { color: fg }]}>{props.label}</Text>}
    </Tap>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  content: { ...contentColumn, padding: 16, paddingBottom: 32, gap: 20 },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, gap: 12 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  addRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.cardAlt,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  sendBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: 18,
    justifyContent: 'center',
    minWidth: 76,
    alignItems: 'center',
  },
  sendText: { color: colors.onAccent, fontWeight: '700', fontSize: 15 },
  section: { gap: 8 },
  sectionTitle: { color: colors.muted, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  info: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 15, fontWeight: '600' },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  playing: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  playingText: { color: colors.accent, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shrink: { flexShrink: 1 },
  newBadge: {
    color: colors.onAccent,
    backgroundColor: colors.accent,
    fontSize: 10,
    fontWeight: '800',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  quote: { color: colors.text, fontSize: 13, fontStyle: 'italic', marginTop: 4, lineHeight: 18 },
  listened: { color: colors.accent, fontSize: 12, fontWeight: '600', marginTop: 2 },
  more: { alignItems: 'center', paddingVertical: 6 },
  moreText: { color: colors.accent, fontWeight: '700' },
  chevron: { color: colors.muted, fontSize: 24, paddingHorizontal: 4 },
  smallBtn: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, minWidth: 72, alignItems: 'center' },
  smallText: { fontWeight: '600', fontSize: 13 },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 8, lineHeight: 20 },
  error: { color: colors.danger, textAlign: 'center' },
}));
