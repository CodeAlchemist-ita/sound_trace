import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';

const NATIVE = Platform.OS !== 'web';
const BARS = [0.9, 0.5, 0.75];

/** Three small bars that move while music is playing (still when `playing` is false). */
export function Equalizer({ color, playing = true, size = 14 }: { color: string; playing?: boolean; size?: number }) {
  const [values] = useState(() => BARS.map((v) => new Animated.Value(v)));

  useEffect(() => {
    if (!playing) return;
    const loops = values.map((value, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, { toValue: 1, duration: 320 + i * 90, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
          Animated.timing(value, { toValue: 0.3, duration: 380 + i * 70, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [playing, values]);

  return (
    <View style={[styles.row, { width: size, height: size }]} accessibilityElementsHidden importantForAccessibility="no">
      {values.map((value, i) => (
        <Animated.View
          key={i}
          style={{
            flex: 1,
            height: size,
            borderRadius: 1,
            backgroundColor: color,
            // Grow from the bottom: scale around the center, then shift down by the missing half.
            transform: [
              { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [size / 2, 0] }) },
              { scaleY: value },
            ],
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, overflow: 'hidden' },
});
