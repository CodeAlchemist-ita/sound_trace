import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

/** PC (web) only: Spotify redirects here after login with ?code=…&state=… */
export default function CallbackScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ code?: string; state?: string; error?: string }>();
  const { completeWebLogin, setError } = useAuth();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // the code can be used only once
    started.current = true;
    if (Platform.OS !== 'web') {
      router.replace('/');
      return;
    }
    completeWebLogin(params)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => router.replace('/'));
  }, [completeWebLogin, params, setError]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}
