import { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Cover } from '@/components/Cover';
import { FadeIn } from '@/components/FadeIn';
import { Tap } from '@/components/Tap';
import { msg, t } from '@/lib/i18n';
import { lyricsSearchUrl } from '@/lib/lyrics';
import { useLyrics, type LyricsView } from '@/lib/useLyrics';
import { useNowPlaying } from '@/lib/nowPlaying';
import { contentColumn, makeStyles, radius, useTheme } from '@/lib/theme';

/** Grey bars that pulse while text is on its way. */
function Skeleton({ lines }: { lines: number }) {
  const styles = useStyles();
  const [pulse] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View style={[styles.skeleton, { opacity: pulse }]}>
      {Array.from({ length: lines }, (_, i) => (
        <View key={i} style={[styles.bar, { width: `${[92, 78, 85, 60, 88, 70][i % 6]}%` }]} />
      ))}
    </Animated.View>
  );
}

const ERROR_MESSAGES: Record<string, string> = {
  not_configured: msg('Traduzione non configurata'),
  quota: msg('Limite di traduzione raggiunto'),
  too_long: msg('Testo troppo lungo da tradurre'),
};

/** Original and translated text line by line, when both have the same number of lines. */
function interleave(original: string, translated: string) {
  const a = original.split('\n');
  const b = translated.split('\n');
  return a.length === b.length ? a.map((line, i) => ({ line, tr: b[i] })) : null;
}

export default function LyricsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const now = useNowPlaying();
  const track = now.status === 'playing' ? now.track : null;
  const { lyrics, translation, view, setView, showTranslation, requestTranslation, hideTranslation, retry } =
    useLyrics(track);

  function body() {
    if (now.status === 'loading') return <ActivityIndicator color={colors.accent} style={styles.spinner} />;
    if (now.status === 'no_scope') {
      return <Text style={styles.message}>{t('Per vedere il testo serve il permesso di Spotify sul brano in riproduzione: accedi di nuovo dalle Impostazioni.')}</Text>;
    }
    if (!track) return <Text style={styles.message}>{t('Nessun brano in riproduzione.')}</Text>;
    if (lyrics.status === 'idle' || lyrics.status === 'loading') return <Skeleton lines={12} />;
    if (lyrics.status === 'not_found') {
      return (
        <View style={styles.notFound}>
          <Text style={styles.message}>{t('Testo non trovato')}</Text>
          <Tap
            onPress={() => Linking.openURL(lyricsSearchUrl(track.trackName, track.artist)).catch(() => undefined)}
            style={styles.primary}
            accessibilityRole="link"
          >
            <Text style={styles.primaryText}>{t('Cerca il testo sul web')}</Text>
          </Tap>
          <Tap onPress={retry} style={styles.secondary} accessibilityRole="button">
            <Text style={styles.secondaryText}>{t('Riprova')}</Text>
          </Tap>
        </View>
      );
    }
    if (lyrics.status === 'instrumental') return <Text style={styles.message}>{t('Brano strumentale')}</Text>;
    if (lyrics.status === 'error') {
      return (
        <View style={styles.errorBox}>
          <Text style={styles.message}>{t('Non sono riuscito a caricare il testo.')}</Text>
          <Tap onPress={retry} style={styles.secondary} accessibilityRole="button">
            <Text style={styles.secondaryText}>{t('Riprova')}</Text>
          </Tap>
        </View>
      );
    }

    const original = lyrics.text ?? '';
    const translated = translation.text ?? '';
    const paired = view === 'both' && showTranslation ? interleave(original, translated) : null;
    return (
      <>
        <View style={styles.controls}>
          {showTranslation ? (
            <View style={styles.segmented}>
              {(
                [
                  ['original', msg('Originale')],
                  ['translated', msg('Traduzione')],
                  ['both', msg('Entrambi')],
                ] as [LyricsView, string][]
              ).map(([value, label]) => (
                <Tap
                  key={value}
                  onPress={() => (value === 'original' ? hideTranslation() : setView(value))}
                  style={[styles.segment, view === value && styles.segmentOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: view === value }}
                >
                  <Text style={[styles.segmentText, view === value && styles.segmentTextOn]}>{t(label)}</Text>
                </Tap>
              ))}
            </View>
          ) : (
            <Tap
              onPress={requestTranslation}
              disabled={translation.status === 'loading'}
              dimmed={translation.status === 'loading'}
              style={styles.primary}
              accessibilityRole="button"
            >
              {translation.status === 'loading' ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={styles.primaryText}>{t('Traduci in italiano')}</Text>
              )}
            </Tap>
          )}
        </View>

        {translation.status === 'error' && (
          <View style={styles.errorBox}>
            <Text style={styles.error}>
              {t(ERROR_MESSAGES[translation.errorCode ?? ''] ?? msg('Traduzione non riuscita'))}
            </Text>
            {translation.errorCode !== 'not_configured' && (
              <Tap onPress={retry} style={styles.secondary} accessibilityRole="button">
                <Text style={styles.secondaryText}>{t('Riprova')}</Text>
              </Tap>
            )}
          </View>
        )}
        {translation.status === 'loading' && <Skeleton lines={4} />}

        {view === 'original' || !showTranslation ? (
          <Text selectable style={styles.lyrics}>
            {original}
          </Text>
        ) : view === 'translated' ? (
          <Text selectable style={styles.lyrics}>
            {translated}
          </Text>
        ) : paired ? (
          <View>
            {paired.map((p, i) => (
              <View key={i} style={p.line.trim() ? styles.pair : styles.gap}>
                <Text selectable style={styles.lyrics}>
                  {p.line}
                </Text>
                {p.line.trim() ? (
                  <Text selectable style={[styles.lyrics, styles.translated]}>
                    {p.tr}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.stack}>
            <Text selectable style={styles.lyrics}>
              {original}
            </Text>
            <Text selectable style={[styles.lyrics, styles.translated]}>
              {translated}
            </Text>
          </View>
        )}

        <Text style={styles.footer}>
          {showTranslation ? `${t('Testo da LRCLIB')} · ${t('Traduzione DeepL')}` : t('Testo da LRCLIB')}
        </Text>
      </>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {track && (
        <View style={styles.head}>
          <Cover uri={track.imageUrl} size={56} />
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={2}>
              {track.trackName}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {track.artist}
            </Text>
          </View>
        </View>
      )}
      <FadeIn>{body()}</FadeIn>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { ...contentColumn, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40, gap: 16 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    info: { flex: 1, minWidth: 0 },
    name: { color: colors.text, fontSize: 18, fontWeight: '700' },
    sub: { color: colors.muted, fontSize: 13, marginTop: 2 },
    spinner: { marginVertical: 32 },
    message: { color: colors.muted, textAlign: 'center', paddingVertical: 32, fontSize: 15 },
    skeleton: { gap: 12, paddingVertical: 8 },
    bar: { height: 14, borderRadius: 7, backgroundColor: colors.cardAlt },
    controls: { flexDirection: 'row', marginBottom: 12 },
    primary: { backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, minWidth: 170, alignItems: 'center' },
    primaryText: { color: colors.onAccent, fontWeight: '700' },
    secondary: { paddingVertical: 10, paddingHorizontal: 12 },
    secondaryText: { color: colors.accent, fontWeight: '700' },
    segmented: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.lg, padding: 3 },
    segment: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.lg - 3 },
    segmentOn: { backgroundColor: colors.accent },
    segmentText: { color: colors.muted, fontWeight: '700', fontSize: 13 },
    segmentTextOn: { color: colors.onAccent },
    notFound: { alignItems: 'center', gap: 4 },
    errorBox: { alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
    error: { color: colors.muted, fontSize: 13 },
    lyrics: { color: colors.text, fontSize: 16, lineHeight: 25 },
    translated: { color: colors.muted, fontStyle: 'italic' },
    pair: {},
    gap: { height: 16 },
    stack: { gap: 24 },
    footer: { color: colors.muted, fontSize: 11, marginTop: 16 },
  }),
);
