import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, Tabs } from 'expo-router';
import { useEffect, type ComponentProps } from 'react';
import { StyleSheet, View, type ColorValue } from 'react-native';

import { Tap } from '@/components/Tap';
import { friendsEnabled } from '@/lib/friends';
import { hapticTap } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { refreshUnseen, useUnseenRecommendations } from '@/lib/recommend';
import { useTheme } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Filled icon for the selected tab, outline for the others. */
function icon(name: string) {
  return function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Ionicons name={(focused ? name : `${name}-outline`) as IconName} color={color as string} size={23} />;
  };
}

/** Recent plays and settings live in the header, so the tab bar keeps five items. */
function HeaderActions() {
  const { colors } = useTheme();
  return (
    <View style={styles.actions}>
      <Link href="/recent" asChild>
        <Tap hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Ascoltati di recente')} style={styles.action}>
          <Ionicons name="time-outline" size={23} color={colors.text} />
        </Tap>
      </Link>
      <Link href="/settings" asChild>
        <Tap hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Impostazioni')} style={styles.action}>
          <Ionicons name="settings-outline" size={22} color={colors.text} />
        </Tap>
      </Link>
    </View>
  );
}

export default function TabsLayout() {
  // useTheme also re-renders the titles when the language changes.
  const { colors } = useTheme();
  const unseen = useUnseenRecommendations();
  // Songs recommended while the app was closed: show the badge from the start.
  useEffect(() => {
    if (friendsEnabled) refreshUnseen();
  }, []);
  return (
    <Tabs
      screenListeners={{ tabPress: hapticTap }}
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '800', fontSize: 22 },
        headerShadowVisible: false,
        headerRight: () => <HeaderActions />,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: { backgroundColor: colors.card, borderTopWidth: 0, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginTop: 2 },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('Home'), tabBarIcon: icon('home') }} />
      <Tabs.Screen name="tracks" options={{ title: t('Classifiche'), tabBarIcon: icon('trophy') }} />
      <Tabs.Screen name="stats" options={{ title: t('Statistiche'), tabBarIcon: icon('pie-chart') }} />
      <Tabs.Screen name="playlists" options={{ title: t('Playlist'), tabBarIcon: icon('albums') }} />
      <Tabs.Screen
        name="friends"
        options={{
          title: t('Amici'),
          // Friends live online: hidden when the Supabase part isn't configured.
          href: friendsEnabled ? undefined : null,
          tabBarIcon: icon('people'),
          tabBarBadge: unseen > 0 ? unseen : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.accent, color: colors.onAccent },
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingRight: 16 },
  action: { padding: 2 },
});
