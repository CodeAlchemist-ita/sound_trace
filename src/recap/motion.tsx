import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { formatNumber } from '@/lib/format';

import { NATIVE, withAlpha } from './helpers';
import { styles } from './styles';

// The animations of the recap stories: how things enter and how bars grow.

/** The whole story fading in when it becomes the current one. */
export function StoryFade({ children }: { children: ReactNode }) {
  const [anim] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 380, useNativeDriver: NATIVE }).start();
  }, [anim]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] });
  return <Animated.View style={[styles.fadeIn, { opacity: anim, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

/** Slides up and fades in after `delay` ms. */
export function Rise({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const [anim] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 450, delay, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }).start();
  }, [anim, delay]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });
  return <Animated.View style={[style, { opacity: anim, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

/** Springs in from small, for covers and icons. */
export function Pop({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const [anim] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.spring(anim, { toValue: 1, delay, friction: 6, tension: 60, useNativeDriver: NATIVE }).start();
  }, [anim, delay]);
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  return (
    <Animated.View
      style={{
        opacity: anim.interpolate({ inputRange: [0, 0.4], outputRange: [0, 1], extrapolate: 'clamp' }),
        transform: [{ scale }],
        alignSelf: 'flex-start',
      }}
    >
      {children}
    </Animated.View>
  );
}

/** Number that counts up from 0. */
export function CountUp({ value, style, duration = 1600 }: { value: number; style: StyleProp<TextStyle>; duration?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const anim = new Animated.Value(0);
    const id = anim.addListener(({ value: v }) => setShown(v));
    Animated.timing(anim, { toValue: value, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => {
      anim.removeListener(id);
      anim.stopAnimation();
    };
  }, [value, duration]);
  return (
    <Text style={style} adjustsFontSizeToFit numberOfLines={1}>
      {formatNumber(Math.round(shown))}
    </Text>
  );
}

function useGrow(delay: number) {
  const [anim] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 700, delay, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [anim, delay]);
  return anim;
}

/** Bar chart whose bars grow one after the other; `highlight` is the brightest. */
export function GrowBars({ values, labels, highlight, fg }: { values: number[]; labels: string[]; highlight: number; fg: string }) {
  const max = Math.max(...values, 1);
  return (
    <View style={styles.bars}>
      {values.map((v, i) => (
        <View key={i} style={styles.barCol}>
          <View style={styles.barTrack}>
            <GrowBar pct={Math.max(2, (v / max) * 100)} delay={300 + i * 35} color={i === highlight ? fg : withAlpha(fg, 0.4)} />
          </View>
          <Text style={[styles.barLabel, { color: fg }]} numberOfLines={1}>
            {labels[i]}
          </Text>
        </View>
      ))}
    </View>
  );
}

function GrowBar({ pct, delay, color }: { pct: number; delay: number; color: string }) {
  const anim = useGrow(delay);
  return (
    <Animated.View
      style={{
        height: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${pct}%`] }),
        backgroundColor: color,
        borderRadius: 4,
      }}
    />
  );
}

/** A labelled horizontal gauge, 0–1. */
export function Meter({ label, value, text, fg, delay }: { label: string; value: number; text: string; fg: string; delay: number }) {
  const anim = useGrow(delay);
  return (
    <View style={styles.meter}>
      <View style={styles.meterHead}>
        <Text style={[styles.meterLabel, { color: fg }]}>{label}</Text>
        <Text style={[styles.meterValue, { color: fg }]}>{text}</Text>
      </View>
      <View style={[styles.meterTrack, { backgroundColor: withAlpha(fg, 0.18) }]}>
        <Animated.View
          style={[
            styles.meterFill,
            { backgroundColor: fg, width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${Math.max(3, value * 100)}%`] }) },
          ]}
        />
      </View>
    </View>
  );
}

/** One of the two bars of the "this year vs last year" story. */
export function CompareBar(props: { label: string; value: number; text: string; fg: string; dim?: boolean; delay: number }) {
  const anim = useGrow(props.delay);
  const { fg } = props;
  return (
    <View style={styles.compareRow}>
      <Text style={[styles.compareLabel, { color: fg }]}>{props.label}</Text>
      <View style={{ flex: 1 }}>
        <Animated.View
          style={[
            styles.compareFill,
            {
              backgroundColor: props.dim ? withAlpha(fg, 0.35) : fg,
              width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${Math.max(4, props.value * 100)}%`] }),
            },
          ]}
        />
        <Text style={[styles.compareText, { color: fg }]}>{props.text}</Text>
      </View>
    </View>
  );
}
