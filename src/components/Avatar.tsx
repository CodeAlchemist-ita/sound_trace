import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';

/** Spotify profile picture, or the first letter of the name. */
export function Avatar({ uri, name, size = 44 }: { uri: string | null; name: string; size?: number }) {
  const { colors } = useTheme();
  const style = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <Image source={uri} style={style} cachePolicy="memory-disk" recyclingKey={uri} transition={120} />;
  return (
    <View style={[style, { backgroundColor: colors.accentDim, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color: colors.accent, fontSize: size * 0.42, fontWeight: '700' }}>
        {name.trim().charAt(0).toUpperCase() || '?'}
      </Text>
    </View>
  );
}
