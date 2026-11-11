import { useState } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { hapticTap } from '@/lib/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
// The native driver doesn't exist in the browser build.
const NATIVE = Platform.OS !== 'web';

type Props = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** Vibrate lightly on press (phones, if enabled in Settings). */
  haptic?: boolean;
  /** How much the element shrinks while pressed; 1 = not at all (long list rows). */
  scaleTo?: number;
  /** Shown faded, e.g. a button that can't be used yet. (Tap animates opacity itself, so a style can't.) */
  dimmed?: boolean;
};

/**
 * A Pressable that answers the finger: it shrinks and dims a little while pressed and
 * gives a light vibration. Takes a plain style (not a function), so it also works as
 * the child of `<Link asChild>`.
 */
export function Tap({ style, haptic = true, scaleTo = 0.97, dimmed = false, onPressIn, onPressOut, onPress, ...rest }: Props) {
  const [pressed] = useState(() => new Animated.Value(0));
  const animate = (toValue: number) =>
    Animated.spring(pressed, { toValue, useNativeDriver: NATIVE, speed: 50, bounciness: 0 }).start();

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e: GestureResponderEvent) => {
        animate(1);
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        animate(0);
        onPressOut?.(e);
      }}
      onPress={
        onPress &&
        ((e: GestureResponderEvent) => {
          if (haptic) hapticTap();
          onPress(e);
        })
      }
      style={[
        style,
        {
          opacity: pressed.interpolate({ inputRange: [0, 1], outputRange: dimmed ? [0.5, 0.4] : [1, 0.65] }),
          transform: [{ scale: pressed.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] }) }],
        },
      ]}
    />
  );
}
