import '@/lib/backgroundSync'; // registers the background task definition at startup

import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Tap } from '@/components/Tap';
import { AuthProvider, useAuth } from '@/lib/auth';
import { installErrorHandlers, logError } from '@/lib/errorLog';
import { t } from '@/lib/i18n';
import { loadSettings, useSettings } from '@/lib/settings';
import { makeStyles, radius, useTheme } from '@/lib/theme';

installErrorHandlers();

function RootNavigator() {
  const { status, registration } = useAuth();
  const { colors } = useTheme();
  // Screen titles are translated here, so they follow the language chosen in Settings.
  useSettings();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const withHeader = {
    headerShown: true,
    headerStyle: { backgroundColor: colors.bg },
    headerTintColor: colors.text,
    headerShadowVisible: false,
    headerBackTitle: t('Indietro'),
  };

  // 1. register (email) → 2. login (Spotify account with that email) → app.
  const ready = status === 'signedIn' && !!registration?.linked;
  // Where a blocked screen sends you. Without an explicit target Expo Router picks the
  // first unguarded screen (callback), which redirects to "/" again: an endless loop.
  const home = ready ? '/' : registration ? '/login' : '/register';
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={ready} redirectTo={home}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="recap" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
        <Stack.Screen name="detail" options={withHeader} />
        <Stack.Screen name="day" options={withHeader} />
        <Stack.Screen name="friend" options={withHeader} />
        <Stack.Screen name="recommend" options={{ ...withHeader, title: t('Consiglia a un amico') }} />
        <Stack.Screen name="lyrics" options={{ ...withHeader, title: t('Testo') }} />
        <Stack.Screen name="playlist" options={{ ...withHeader, title: t('Playlist') }} />
        <Stack.Screen name="recent" options={{ ...withHeader, title: t('Ascoltati di recente') }} />
        <Stack.Screen name="settings" options={{ ...withHeader, title: t('Impostazioni') }} />
        <Stack.Screen name="errors" options={{ ...withHeader, title: t('Registro errori') }} />
      </Stack.Protected>
      <Stack.Protected guard={!registration} redirectTo={home}>
        <Stack.Screen name="register" />
      </Stack.Protected>
      <Stack.Protected guard={!!registration && !ready} redirectTo={home}>
        <Stack.Screen name="login" />
      </Stack.Protected>
      {/* PC login lands here before we know if the user is signed in. */}
      <Stack.Screen name="callback" />
    </Stack>
  );
}

export default function RootLayout() {
  const { colors, dark } = useTheme();
  // Saved preferences (theme, language…) are read before the first screen, so the app
  // doesn't flash in the wrong theme or language.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadSettings().finally(() => setReady(true));
  }, []);

  // The window behind the screens (visible during transitions and overscroll).
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.bg).catch(() => undefined);
  }, [colors.bg]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <AuthProvider>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <RootNavigator />
    </AuthProvider>
  );
}

/** Shown instead of a white screen when a screen crashes while rendering. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const styles = useStyles();

  useEffect(() => {
    logError(error, 'screen');
  }, [error]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('Qualcosa è andato storto')}</Text>
      <Text style={styles.text}>
        {t('L’app ha incontrato un errore imprevisto. I tuoi ascolti sono al sicuro: riprova, e se succede ancora condividi il registro errori da Impostazioni.')}
      </Text>
      <Text style={styles.detail} selectable>
        {error.message}
      </Text>
      <Tap onPress={retry} style={styles.button} accessibilityRole="button">
        <Text style={styles.buttonText}>{t('Riprova')}</Text>
      </Tap>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 14, maxWidth: 560, width: '100%', alignSelf: 'center' },
  title: { color: colors.text, fontSize: 24, fontWeight: '800' },
  text: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  detail: {
    color: colors.danger,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: 12,
    fontSize: 13,
    lineHeight: 18,
  },
  button: { backgroundColor: colors.accent, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  buttonText: { color: colors.onAccent, fontSize: 16, fontWeight: '800' },
}));
