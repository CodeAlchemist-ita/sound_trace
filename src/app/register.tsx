import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FadeIn } from '@/components/FadeIn';
import { Tap } from '@/components/Tap';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { REGISTER_URL, isValidEmail } from '@/lib/registration';
import { contentColumn, makeStyles, radius, useTheme } from '@/lib/theme';

/** Step 1 of 2: the email of the Spotify account. Step 2 is the login screen. */
export default function RegisterScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { register, status } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = isValidEmail(email);

  async function onSubmit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await register(email);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.inner} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FadeIn style={styles.hero}>
          <Text style={styles.step}>{t('Passo 1 di 2')}</Text>
          <Text style={styles.title}>{t('Registrati')}</Text>
          <Text style={styles.body}>
            {t('Inserisci l’email del tuo account Spotify. Nel passo successivo accederai a Spotify con lo stesso account.')}
          </Text>
        </FadeIn>

        <View style={styles.form}>
          <Text style={styles.label}>{t('Email dell’account Spotify')}</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            onSubmitEditing={onSubmit}
            placeholder={t('nome@esempio.it')}
            placeholderTextColor={colors.muted}
            style={styles.input}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            editable={!busy}
          />
          <Text style={styles.hint}>
            {t('La trovi nell’app Spotify in Impostazioni → Account. Se accedi a Spotify con Google, Facebook o Apple, è l’email di quell’account.')}
          </Text>
          {error && <Text style={styles.error}>{error}</Text>}
        </View>

        <Tap
          onPress={onSubmit}
          disabled={!valid || busy}
          dimmed={!valid || busy}
          style={styles.button}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={styles.buttonText}>{status === 'signedIn' ? t('Registrati e continua') : t('Registrati')}</Text>
          )}
        </Tap>
        <Text style={styles.footnote}>
          {REGISTER_URL
            ? t('L’email viene salvata online solo per gestire l’accesso all’app e la sincronizzazione tra i tuoi dispositivi.')
            : t('L’email resta su questo dispositivo e serve a verificare l’account Spotify.')}
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { ...contentColumn, maxWidth: 520, flex: 1, padding: 24, justifyContent: 'flex-end', gap: 16 },
  hero: { flex: 1, justifyContent: 'center', gap: 12 },
  step: { color: colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.5 },
  title: { color: colors.text, fontSize: 36, fontWeight: '800', lineHeight: 42 },
  body: { color: colors.muted, fontSize: 16, lineHeight: 23 },
  form: { gap: 8 },
  label: { color: colors.text, fontWeight: '700' },
  input: {
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
  },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  error: { color: colors.danger, lineHeight: 20 },
  button: { backgroundColor: colors.accent, borderRadius: 999, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: colors.onAccent, fontSize: 17, fontWeight: '800' },
  footnote: { color: colors.muted, fontSize: 12, textAlign: 'center', lineHeight: 17 },
}));
