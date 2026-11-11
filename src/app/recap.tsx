import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, Easing, Platform, Pressable, Text, View, type ViewInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { Tap } from '@/components/Tap';
import { ensureArtistImages, ensureTrackCovers, songKey } from '@/lib/covers';
import { hapticTap } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { getRecapYears, getYearRecap, type YearRecap } from '@/lib/recap';
import { useSettings } from '@/lib/settings';
import { darkColors } from '@/lib/theme';
import { NATIVE, withAlpha } from '@/recap/helpers';
import { StoryFade } from '@/recap/motion';
import { StoryBackground } from '@/recap/pieces';
import { EMPTY_SLIDES, SLIDES } from '@/recap/slides';
import { styles } from '@/recap/styles';

/** How long a story stays on screen before moving on by itself. */
const STORY_MS = 7000;
const CAN_SHARE = NATIVE;

/**
 * The yearly recap as stories. This file is only the player (progress bars, taps,
 * pause, sharing); each story is in src/recap/slides, the data in src/lib/recap.ts.
 */
export default function RecapScreen() {
  const params = useLocalSearchParams<{ year?: string }>();
  // The stories read the language when they render.
  useSettings();
  const [year, setYear] = useState(() => Number(params.year) || new Date().getFullYear());
  const [years, setYears] = useState<number[]>([]);
  const [base, setBase] = useState<YearRecap | null>(null);
  const [images, setImages] = useState<{ tracks: Map<string, string>; artists: Map<string, string> }>({
    tracks: new Map(),
    artists: new Map(),
  });
  const [index, setIndex] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [paused, setPaused] = useState(false);
  const shotRef = useRef<ViewInstance>(null);

  useEffect(() => {
    getRecapYears().then(setYears);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getYearRecap(year).then((r) => {
      if (cancelled) return;
      setBase(r);
      setIndex(0);
      // Imported history has no artwork: look up the covers/photos this recap shows.
      const songs = [...r.topTracks, ...(r.firstPlay ? [r.firstPlay] : []), ...(r.topMonthTrack ? [r.topMonthTrack] : [])];
      Promise.all([
        ensureTrackCovers(songs).catch(() => new Map<string, string>()),
        ensureArtistImages(r.topArtists.map((a) => a.artist)).catch(() => new Map<string, string>()),
      ]).then(([tracks, artists]) => !cancelled && setImages({ tracks, artists }));
    });
    return () => {
      cancelled = true;
    };
  }, [year]);

  // The recap with the covers found afterwards filled in.
  const recap = useMemo(() => {
    if (!base) return null;
    const cover = <T extends { trackName: string; artist: string; imageUrl: string | null }>(song: T): T =>
      song.imageUrl ? song : { ...song, imageUrl: images.tracks.get(songKey(song)) ?? null };
    return {
      ...base,
      topTracks: base.topTracks.map(cover),
      firstPlay: base.firstPlay && cover(base.firstPlay),
      topMonthTrack: base.topMonthTrack && cover(base.topMonthTrack),
      topArtists: base.topArtists.map((a) => ({ ...a, imageUrl: images.artists.get(a.artist.toLowerCase()) ?? a.imageUrl })),
    };
  }, [base, images]);

  const slides = useMemo(
    () => (recap && recap.streams > 0 ? SLIDES.filter((s) => !s.show || s.show(recap)) : EMPTY_SLIDES),
    // Only the set of stories matters here, not the covers arriving later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base],
  );
  const isLast = index >= slides.length - 1;

  const close = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/')), []);
  const next = useCallback(() => (isLast ? close() : setIndex((i) => i + 1)), [isLast, close]);
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // ---------- Auto-advance with hold-to-pause ----------
  const [progress] = useState(() => new Animated.Value(0));
  const pausedRef = useRef(false);
  const live = useRef({ next, isLast });
  useEffect(() => {
    live.current = { next, isLast };
  }, [next, isLast]);

  const runFrom = useCallback(
    (from: number) => {
      Animated.timing(progress, {
        toValue: 1,
        duration: STORY_MS * (1 - from),
        easing: Easing.linear,
        useNativeDriver: false,
      }).start(({ finished }) => {
        // The last story stays until you close it or share it.
        if (finished && !live.current.isLast) live.current.next();
      });
    },
    [progress],
  );

  const pause = useCallback(() => {
    pausedRef.current = true;
    setPaused(true);
    progress.stopAnimation();
  }, [progress]);

  const resume = useCallback(() => {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    setPaused(false);
    progress.stopAnimation((v) => runFrom(v));
  }, [progress, runFrom]);

  useEffect(() => {
    progress.setValue(0);
    if (!pausedRef.current && base) runFrom(0);
    return () => progress.stopAnimation();
  }, [index, base, progress, runFrom]);

  // Phone locked / app in background: stop the clock.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? resume() : pause()));
    return () => sub.remove();
  }, [pause, resume]);

  // PC: arrow keys / space to move, Esc to close.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === ' ') (pausedRef.current ? resume : pause)();
      else if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, close, pause, resume]);

  const share = useCallback(async () => {
    pause();
    setCapturing(true);
    try {
      // Let the controls disappear before taking the picture.
      await new Promise((r) => setTimeout(r, 120));
      const uri = await captureRef(shotRef, { format: 'png', quality: 1, result: 'tmpfile' });
      setCapturing(false);
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: t('Condividi il tuo riepilogo') });
    } catch {
      // Share sheet dismissed or capture failed: nothing to do.
    } finally {
      setCapturing(false);
    }
  }, [pause]);

  if (!recap) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={darkColors.accent} />
      </View>
    );
  }

  const slide = slides[Math.min(index, slides.length - 1)];
  const fg = slide.fg;
  return (
    <View style={styles.screen}>
      <View ref={shotRef} collapsable={false} style={styles.phone}>
        <StoryBackground key={slide.id} colors={slide.colors} image={slide.image?.(recap)} fg={fg} />
        <SafeAreaView style={styles.safe}>
          <View style={[styles.progress, capturing && styles.hidden]}>
            {slides.map((s, i) => (
              <View key={s.id} style={[styles.progressTrack, { backgroundColor: withAlpha(fg, 0.25) }]}>
                <Animated.View
                  style={[
                    styles.progressFill,
                    { backgroundColor: fg },
                    i < index
                      ? { width: '100%' }
                      : i > index
                        ? { width: '0%' }
                        : { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
                  ]}
                />
              </View>
            ))}
          </View>
          <View style={styles.topBar}>
            <Text style={[styles.topLabel, { color: fg }]}>
              {t('Il tuo {year}', { year: recap.year })}
              {recap.partial ? ` ${t('(finora)')}` : ''}
            </Text>
            <View style={[styles.topActions, capturing && styles.hidden]}>
              {paused && <Ionicons name="pause" size={18} color={fg} style={{ opacity: 0.8 }} />}
              {CAN_SHARE && recap.streams > 0 && (
                <Tap onPress={share} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('Condividi')}>
                  <Ionicons name="share-outline" size={24} color={fg} />
                </Tap>
              )}
              <Tap onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('Chiudi')}>
                <Ionicons name="close" size={26} color={fg} />
              </Tap>
            </View>
          </View>

          {/* Tap left third = back, rest = forward; hold anywhere = pause (like stories). */}
          <View style={styles.body}>
            <StoryFade key={`${year}-${slide.id}`}>{slide.render(recap, fg)}</StoryFade>
            {!capturing && (
              <>
                <Pressable
                  style={[styles.tapZone, { left: 0, width: '33%' }]}
                  onPress={prev}
                  onPressIn={pause}
                  onPressOut={resume}
                  onLongPress={() => {}}
                  delayLongPress={220}
                  accessibilityLabel={t('Indietro')}
                />
                <Pressable
                  style={[styles.tapZone, { right: 0, width: '67%' }]}
                  onPress={next}
                  onPressIn={pause}
                  onPressOut={resume}
                  onLongPress={() => {}}
                  delayLongPress={220}
                  accessibilityLabel={t('Avanti')}
                />
              </>
            )}
          </View>

          {capturing ? (
            <Text style={[styles.watermark, { color: fg }]}>{t('Spotify Stats · il mio {year} in musica', { year: recap.year })}</Text>
          ) : index === 0 && years.length > 1 ? (
            <View style={styles.years}>
              {years.map((y) => (
                <Pressable
                  key={y}
                  onPress={() => {
                    hapticTap();
                    setYear(y);
                  }}
                  style={[styles.yearChip, { borderColor: fg }, y === year && { backgroundColor: fg }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: y === year }}
                >
                  <Text style={[styles.yearText, { color: y === year ? slide.colors[1] : fg }]}>{y}</Text>
                </Pressable>
              ))}
            </View>
          ) : isLast && recap.streams > 0 ? (
            CAN_SHARE ? (
              <Tap onPress={share} style={[styles.shareButton, { backgroundColor: darkColors.accent }]} accessibilityRole="button">
                <Ionicons name="share-social" size={20} color={darkColors.onAccent} />
                <Text style={styles.shareText}>{t('Condividi il tuo {year}', { year: recap.year })}</Text>
              </Tap>
            ) : (
              <Text style={[styles.foot, { color: darkColors.muted, textAlign: 'center' }]}>
                {t('Fai uno screenshot per condividerlo.')}
              </Text>
            )
          ) : null}
        </SafeAreaView>
      </View>
    </View>
  );
}
