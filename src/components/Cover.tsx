import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';

/** Album cover with a ♪ placeholder; `round` for artists. */
export function Cover({ uri, size = 44, round = false }: { uri: string | null; size?: number; round?: boolean }) {
  const { colors } = useTheme();
  const style = { width: size, height: size, borderRadius: round ? size / 2 : size > 60 ? 12 : 6 };
  if (uri) return <Image source={uri} style={style} cachePolicy="memory-disk" recyclingKey={uri} transition={120} />;
  return (
    <View style={[style, { backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color: colors.muted, fontSize: size / 3 }}>♪</Text>
    </View>
  );
}
