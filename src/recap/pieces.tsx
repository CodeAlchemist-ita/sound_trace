import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { largeCover } from '@/lib/spotify';

import { NATIVE, withAlpha, type Gradient } from './helpers';
import { Pop } from './motion';
import { styles } from './styles';

// The building blocks the stories share: background, covers, rows and number tiles.

/** Gradient, optional blurred cover and two slowly drifting blobs behind a story. */
export function StoryBackground({ colors: c, image, fg }: { colors: Gradient; image?: string | null; fg: string }) {
  const [drift] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 9000, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
        Animated.timing(drift, { toValue: 0, duration: 9000, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [drift]);
  const move = (x: number, y: number) => ({
    transform: [
      { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, x] }) },
      { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, y] }) },
    ],
  });
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={c} start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }} style={StyleSheet.absoluteFill} />
      {image ? (
        <>
          <Image source={largeCover(image)} style={[StyleSheet.absoluteFill, { opacity: 0.55 }]} blurRadius={40} contentFit="cover" />
          <LinearGradient colors={[withAlpha(c[1], 0.35), withAlpha(c[c.length - 1], 0.92)]} style={StyleSheet.absoluteFill} />
        </>
      ) : null}
      <Animated.View style={[styles.blob, { top: -120, right: -140, backgroundColor: withAlpha(fg, 0.08) }, move(-60, 50)]} />
      <Animated.View
        style={[styles.blob, styles.blobSmall, { bottom: -60, left: -110, backgroundColor: withAlpha(fg, 0.06) }, move(70, -40)]}
      />
    </View>
  );
}

/** Album cover or artist photo, with an icon when there's none. `large` loads the 640 px version. */
export function Cover({ url, size, fg, large, round }: { url: string | null; size: number; fg: string; large?: boolean; round?: boolean }) {
  const style = { width: size, height: size, borderRadius: round ? size / 2 : size > 60 ? 14 : 6 };
  return url ? (
    <Image
      source={large ? largeCover(url) : url}
      placeholder={large ? url : undefined}
      style={[style, size > 60 && styles.coverShadow]}
      cachePolicy="memory-disk"
      transition={250}
    />
  ) : (
    <View style={[style, styles.coverEmpty, { backgroundColor: withAlpha(fg, 0.15) }]}>
      <Ionicons name={round ? 'person' : 'musical-notes'} size={size / 2.6} color={fg} />
    </View>
  );
}

/** One big cover and four small ones, for the final summary. */
export function Collage({ urls, fg }: { urls: (string | null)[]; fg: string }) {
  const [first, ...rest] = urls;
  return (
    <View style={styles.collage}>
      <Pop delay={100}>
        <Cover url={first ?? null} size={156} fg={fg} large />
      </Pop>
      <View style={styles.collageGrid}>
        {rest.slice(0, 4).map((u, i) => (
          <Pop key={i} delay={250 + i * 110}>
            <Cover url={u} size={74} fg={fg} />
          </Pop>
        ))}
      </View>
    </View>
  );
}

export function RankRow(props: {
  rank?: number;
  title: string;
  subtitle?: string;
  detail: string;
  fg: string;
  imageUrl?: string | null;
  round?: boolean;
}) {
  const { fg } = props;
  return (
    <View style={styles.rankRow}>
      {props.rank !== undefined && <Text style={[styles.rankNum, { color: fg }]}>{props.rank}</Text>}
      {props.imageUrl !== undefined && <Cover url={props.imageUrl} size={42} fg={fg} round={props.round} />}
      <View style={{ flex: 1 }}>
        <Text style={[styles.rankTitle, { color: fg }]} numberOfLines={1}>
          {props.title}
        </Text>
        {props.subtitle && (
          <Text style={[styles.rankSub, { color: fg }]} numberOfLines={1}>
            {props.subtitle}
          </Text>
        )}
      </View>
      <Text style={[styles.rankDetail, { color: fg }]}>{props.detail}</Text>
    </View>
  );
}

export function Stat({ value, label, fg }: { value: string; label: string; fg: string }) {
  return (
    <View style={[styles.stat, { backgroundColor: withAlpha(fg, 0.14) }]}>
      <Text style={[styles.statValue, { color: fg }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function SummaryCell({ label, value, fg }: { label: string; value: string; fg: string }) {
  return (
    <View style={styles.summaryCell}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, { color: fg }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}
