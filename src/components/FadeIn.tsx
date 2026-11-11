import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, type StyleProp, type ViewStyle } from 'react-native';

const NATIVE = Platform.OS !== 'web';

/**
 * Content that slides up and fades in when it first appears. `delay` (ms) staggers
 * the cards of a screen so they arrive one after the other.
 */
export function FadeIn({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const [shown] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.timing(shown, {
      toValue: 1,
      duration: 280,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    });
    animation.start();
    return () => animation.stop();
  }, [shown, delay]);

  return (
    <Animated.View
      style={[
        style,
        { opacity: shown, transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}
