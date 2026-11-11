import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FadeIn } from '@/components/FadeIn';
import { Tap } from '@/components/Tap';
import { redirectUri, useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { cloudEnabled } from '@/lib/cloudSync';
import { SPOTIFY_CLIENT_ID } from '@/lib/spotify';
import { contentColumn, makeStyles, radius, useTheme } from '@/lib/theme';

/** Step 2 of 2: connect the Spotify account that has the registered email. */
export default function LoginScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { login, canLogin, error, registration, status, linking, retryLink, changeEmail, logout } = useAuth();
  // Signed in to Spotify but the email check hasn't completed (in progress or failed offline).
  const pending = status === 'signedIn';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <FadeIn style={styles.hero}>
          <Text style={styles.kicker}>{t('Passo 2 di 2')}</Text>
          <Text style={styles.title}>{t('Collega il tuo account Spotify')}</Text>
          <Text style={styles.body}>
            {t('Accedi a Spotify con l’account che ha questa email. Servirà a contare i minuti di ascolto da inizio anno e quante volte hai ascoltato ogni canzone.')}
          </Text>
          {registration && (
            <View style={styles.emailBox}>
              <View style={{ flex: 1 }}>
                <Text style={styles.emailLabel}>{t('Registrato come')}</Text>
                <Text style={styles.email} numberOfLines={1}>
                  {registration.email}
                </Text>
              </View>
              {!pending && (
                <Tap onPress={changeEmail} hitSlop={8}>
                  <Text style={styles.change}>{t('Cambia')}</Text>
                </Tap>
              )}
            </View>
          )}
        </FadeIn>

        {!SPOTIFY_CLIENT_ID && (
          <View style={styles.setup}>
            <Text style={styles.setupTitle}>{t('Configurazione mancante')}</Text>
            <Text style={styles.setupText}>
              {t(
                'Imposta EXPO_PUBLIC_SPOTIFY_CLIENT_ID nel file .env e aggiungi questo Redirect URI nella tua app sul Spotify Developer Dashboard:',
              )}
            </Text>
            <Text selectable style={styles.code}>
              {redirectUri}
            </Text>
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        {linking || (pending && !error) ? (
          <View style={styles.checking}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.checkingText}>{t('Verifica dell’account Spotify…')}</Text>
          </View>
        ) : pending ? (
          <>
            <Tap onPress={retryLink} style={styles.button} accessibilityRole="button">
              <Text style={styles.buttonText}>{t('Riprova')}</Text>
            </Tap>
            <Tap onPress={() => logout(false)} style={styles.secondary} accessibilityRole="button">
              <Text style={styles.secondaryText}>{t('Esci da Spotify')}</Text>
            </Tap>
          </>
        ) : (
          <Tap onPress={login} disabled={!canLogin} dimmed={!canLogin} style={styles.button} accessibilityRole="button">
            <Text style={styles.buttonText}>{t('Accedi con Spotify')}</Text>
          </Tap>
        )}
        <Text style={styles.footnote}>
          {cloudEnabled
            ? t('L’app legge solo la cronologia degli ascolti e la sincronizza tra i tuoi dispositivi.')
            : t('I tuoi dati restano su questo dispositivo: l’app legge solo la cronologia degli ascolti.')}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { ...contentColumn, maxWidth: 520, flex: 1, padding: 24, justifyContent: 'flex-end', gap: 16 },
  hero: { flex: 1, justifyContent: 'center', gap: 12 },
  kicker: { color: colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.5 },
  title: { color: colors.text, fontSize: 34, fontWeight: '800', lineHeight: 40 },
  body: { color: colors.muted, fontSize: 16, lineHeight: 23 },
  emailBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: 14,
    marginTop: 8,
  },
  emailLabel: { color: colors.muted, fontSize: 12 },
  email: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 2 },
  change: { color: colors.accent, fontWeight: '700' },
  setup: { backgroundColor: colors.warnDim, borderRadius: radius.md, padding: 16, gap: 8 },
  setupTitle: { color: colors.warn, fontWeight: '700' },
  setupText: { color: colors.text, lineHeight: 20 },
  code: { color: colors.text, fontFamily: 'monospace', backgroundColor: colors.card, padding: 8, borderRadius: 6 },
  error: { color: colors.danger, textAlign: 'center', lineHeight: 20 },
  checking: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, paddingVertical: 16 },
  checkingText: { color: colors.muted },
  button: { backgroundColor: colors.accent, borderRadius: 999, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: colors.onAccent, fontSize: 17, fontWeight: '800' },
  secondary: { alignItems: 'center', paddingVertical: 8 },
  secondaryText: { color: colors.muted, fontWeight: '700' },
  footnote: { color: colors.muted, fontSize: 12, textAlign: 'center' },
}));
