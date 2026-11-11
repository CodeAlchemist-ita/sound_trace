import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Tap } from '@/components/Tap';
import { redirectUri, useAuth } from '@/lib/auth';
import { cloudEnabled, cloudSync } from '@/lib/cloudSync';
import { fillMissingCovers } from '@/lib/covers';
import { notifyDataChanged, useDataVersion } from '@/lib/dataEvents';
import { getMeta } from '@/lib/db';
import { askLogout, showMessage } from '@/lib/dialog';
import { getErrorLog, logError, onErrorLogged } from '@/lib/errorLog';
import { formatDate, formatDateTime } from '@/lib/format';
import { friendsEnabled, getPrivacy, PRIVACY_KEYS, setPrivacy, type Privacy } from '@/lib/friends';
import { hapticError, hapticSuccess, hapticTap } from '@/lib/haptics';
import { msg, plural, t } from '@/lib/i18n';
import { pickAndImportHistory } from '@/lib/importHistory';
import { MIN_STREAM_CHOICES, updateSettings, useSettings } from '@/lib/settings';
import { loadTokens } from '@/lib/spotify';
import { syncRecentlyPlayed } from '@/lib/sync';
import { contentColumn, makeStyles, radius, useTheme } from '@/lib/theme';

/** Italian keys: shown with t(). */
const PRIVACY_TEXT: Record<keyof Privacy, { label: string; hint: string }> = {
  nowPlaying: {
    label: msg('Cosa sto ascoltando ora'),
    hint: msg('Il brano in riproduzione in questo momento.'),
  },
  recent: {
    label: msg('Ascolti recenti'),
    hint: msg('Gli ultimi brani che hai ascoltato, con data e ora.'),
  },
  stats: {
    label: msg('Statistiche e classifiche'),
    hint: msg('Tempo e numero di ascolti, artisti e brani più ascoltati, e quanto ascolti i brani delle tue playlist.'),
  },
  playlists: {
    label: msg('Playlist'),
    hint: msg('Le tue playlist e i brani che contengono.'),
  },
  recommendations: {
    label: msg('Ricevere consigli'),
    hint: msg('Gli amici possono consigliarti brani da ascoltare.'),
  },
};

/**
 * What friends may see, one switch per kind of data. The choices live on the server,
 * which enforces them: a switch moves only after the server has saved it.
 */
function PrivacySection() {
  const styles = useStyles();
  const { colors } = useTheme();
  const [privacy, setPrivacyState] = useState<Privacy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<keyof Privacy | null>(null);

  const load = useCallback(() => {
    getPrivacy()
      .then((p) => {
        setPrivacyState(p);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(load, [load]);

  async function onToggle(key: keyof Privacy, value: boolean) {
    setSaving(key);
    try {
      setPrivacyState(await setPrivacy({ [key]: value }));
      setError(null);
      hapticTap();
    } catch (e) {
      hapticError();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  return (
    <Section title={t('Cosa vedono gli amici')}>
      <Text style={styles.text}>
        {t(
          'Scegli cosa possono vedere di te gli amici che hai accettato. Quello che spegni sparisce subito dai loro schermi; tu continui a vedere tutto di te stesso.',
        )}
      </Text>
      {!privacy && !error && <ActivityIndicator color={colors.accent} />}
      {privacy &&
        PRIVACY_KEYS.map((key) => (
          <View key={key} style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>{t(PRIVACY_TEXT[key].label)}</Text>
              <Text style={styles.meta}>{t(PRIVACY_TEXT[key].hint)}</Text>
            </View>
            <Switch
              value={privacy[key]}
              disabled={saving !== null}
              onValueChange={(value) => onToggle(key, value)}
              trackColor={{ true: colors.accent, false: colors.border }}
              accessibilityLabel={t(PRIVACY_TEXT[key].label)}
            />
          </View>
        ))}
      {error && (
        <>
          <Text style={styles.error}>
            {privacy ? t('Modifica non salvata: {error}', { error }) : t('Impossibile leggere le tue scelte: {error}', { error })}
          </Text>
          {!privacy && <Button label={t('Riprova')} onPress={load} />}
        </>
      )}
    </Section>
  );
}

export default function SettingsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const settings = useSettings();
  const { logout, registration } = useAuth();
  const version = useDataVersion();
  const [busy, setBusy] = useState<'import' | 'sync' | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [importedUntil, setImportedUntil] = useState<number | null>(null);
  const [lastCloudSyncAt, setLastCloudSyncAt] = useState<number | null>(null);
  // True once the server holds this account's session and syncs it every 15 minutes.
  const [serverSync, setServerSync] = useState(false);
  const [errorCount, setErrorCount] = useState(0);

  const loadMeta = useCallback(() => {
    getMeta('lastSyncAt').then((v) => setLastSyncAt(v ? Number(v) : null));
    getMeta('lastCloudSyncAt').then((v) => setLastCloudSyncAt(v ? Number(v) : null));
    getMeta('importedUntil').then((v) => setImportedUntil(v ? Number(v) : null));
    loadTokens().then((tokens) => setServerSync(!!tokens?.serverKey));
    getErrorLog().then((log) => setErrorCount(log.length));
  }, []);

  // Refresh on data changes and whenever the tab is opened (syncs with no new plays don't notify).
  useEffect(loadMeta, [loadMeta, version]);
  useFocusEffect(loadMeta);
  useEffect(() => onErrorLogged(loadMeta), [loadMeta]);

  async function onImport() {
    setBusy('import');
    try {
      const r = await pickAndImportHistory();
      if (r) {
        hapticSuccess();
        showMessage(
          t('Importazione completata'),
          [
            plural(r.files, '{n} file letto', '{n} file letti'),
            plural(r.read, '{n} brano trovato', '{n} brani trovati'),
            plural(r.inserted, '{n} nuovo ascolto salvato.', '{n} nuovi ascolti salvati.'),
          ].join(', '),
        );
        notifyDataChanged();
        // Upload the imported history so the other devices get it too.
        cloudSync()
          .then(() => loadMeta())
          .catch((e) => showMessage(t('Sincronizzazione online'), e instanceof Error ? e.message : String(e)));
        // Exported files have no artwork: fetch covers for the top tracks in the background.
        fillMissingCovers()
          .then((added) => added > 0 && notifyDataChanged())
          .catch(console.warn);
      }
    } catch (e) {
      hapticError();
      logError(e, 'import');
      showMessage(t('Importazione non riuscita'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onSync() {
    setBusy('sync');
    try {
      const n = await syncRecentlyPlayed();
      const fromCloud = await cloudSync();
      notifyDataChanged();
      const parts = [
        n === 0 ? t('Nessun nuovo ascolto da Spotify.') : plural(n, '{n} nuovo ascolto da Spotify.', '{n} nuovi ascolti da Spotify.'),
      ];
      if (cloudEnabled) {
        parts.push(plural(fromCloud, '{n} modifica dagli altri dispositivi.', '{n} modifiche dagli altri dispositivi.'));
      }
      hapticSuccess();
      showMessage(t('Aggiornato'), parts.join(' '));
    } catch (e) {
      hapticError();
      showMessage(t('Errore'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onLogout() {
    const choice = await askLogout();
    if (!choice) return;
    try {
      await logout(choice === 'wipe');
    } catch (e) {
      showMessage(t('Uscita non riuscita'), e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Section title={t('Aspetto')}>
        <Field label={t('Tema')}>
          <Choice
            value={settings.theme}
            onChange={(theme) => updateSettings({ theme })}
            options={[
              { value: 'system', label: t('Sistema') },
              { value: 'dark', label: t('Scuro') },
              { value: 'light', label: t('Chiaro') },
            ]}
          />
        </Field>
        <Field label={t('Lingua')}>
          <Choice
            value={settings.language}
            onChange={(language) => updateSettings({ language })}
            options={[
              { value: 'it', label: 'Italiano' },
              { value: 'en', label: 'English' },
            ]}
          />
        </Field>
        {Platform.OS !== 'web' && (
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>{t('Vibrazione al tocco')}</Text>
              <Text style={styles.meta}>{t('Una vibrazione leggera quando tocchi pulsanti, schede e righe.')}</Text>
            </View>
            <Switch
              value={settings.haptics}
              onValueChange={(haptics) => {
                updateSettings({ haptics }).then(() => haptics && hapticTap());
              }}
              trackColor={{ true: colors.accent, false: colors.border }}
              accessibilityLabel={t('Vibrazione al tocco')}
            />
          </View>
        )}
      </Section>

      {friendsEnabled && <PrivacySection />}

      <Section title={t('Come si contano gli ascolti')}>
        <Field
          label={t('Durata minima di un ascolto')}
          hint={t(
            'Sotto questa durata un brano conta come saltato. Spotify usa 30 secondi. Vale per la cronologia importata: degli ascolti letti in diretta da Spotify la durata non è nota, quindi contano sempre. Le statistiche degli amici usano sempre 30 secondi.',
          )}
        >
          <Choice
            value={settings.minStreamSec}
            onChange={(minStreamSec) => updateSettings({ minStreamSec }).then(notifyDataChanged)}
            options={MIN_STREAM_CHOICES.map((sec) => ({ value: sec, label: t('{n} s', { n: sec }) }))}
          />
        </Field>
        <Field label={t('La settimana inizia di')} hint={t('Ordina il calendario e il grafico dei giorni della settimana.')}>
          <Choice
            value={settings.weekStart}
            onChange={(weekStart) => updateSettings({ weekStart })}
            options={[
              { value: 'monday', label: t('Lunedì') },
              { value: 'sunday', label: t('Domenica') },
            ]}
          />
        </Field>
      </Section>

      <Section title={t('Cronologia completa dell’anno')}>
        <Text style={styles.text}>
          {t(
            'Spotify fa leggere alle app solo gli ultimi 50 brani ascoltati. Da quando hai effettuato l’accesso l’app li salva in automatico, ma per gli ascolti precedenti serve la tua cronologia:',
          )}
        </Text>
        <Text style={styles.step}>{t('1. Su spotify.com apri Account → Privacy → Scarica i tuoi dati.')}</Text>
        <Text style={styles.step}>
          {t('2. Richiedi la «Cronologia streaming estesa» (più precisa) oppure i «Dati dell’account».')}
        </Text>
        <Text style={styles.step}>
          {t(
            '3. Quando ricevi l’email, estrai lo zip e seleziona qui i file .json (Streaming_History_Audio_… o StreamingHistory_music_…).',
          )}
        </Text>
        <Tap onPress={() => Linking.openURL('https://www.spotify.com/account/privacy/')} accessibilityRole="link">
          <Text style={styles.link}>{t('Apri la pagina Privacy di Spotify →')}</Text>
        </Tap>
        <Button label={t('Importa file della cronologia')} onPress={onImport} loading={busy === 'import'} primary />
        {importedUntil && (
          <Text style={styles.meta}>{t('Cronologia importata fino al {date}', { date: formatDate(importedUntil) })}</Text>
        )}
      </Section>

      <Section title={t('Sincronizzazione')}>
        <Text style={styles.text}>
          {serverSync
            ? t(
                'Il server salva i tuoi ascolti ogni 15 minuti, anche con l’app chiusa o il telefono spento: non si perde più niente e gli amici vedono sempre dati aggiornati. L’app scarica i nuovi ascolti quando la apri.',
              )
            : Platform.OS === 'web'
              ? t(
                  'Sul PC l’app si aggiorna quando la apri e ogni 10 minuti finché la scheda resta aperta. Se ascolti più di ~50 brani senza aprirla, i più vecchi potrebbero non essere salvati.',
                )
              : t(
                  'L’app si aggiorna quando la apri e periodicamente in background (il sistema decide quando). Se ascolti più di ~50 brani senza aprirla, i più vecchi potrebbero non essere salvati.',
                )}
        </Text>
        <Button label={t('Aggiorna ora')} onPress={onSync} loading={busy === 'sync'} />
        <Text style={styles.meta}>
          {lastSyncAt ? t('Ultimo aggiornamento: {date}', { date: formatDateTime(lastSyncAt) }) : t('Mai aggiornato')}
        </Text>
      </Section>

      <Section title={t('Telefono e PC')}>
        <Text style={styles.text}>
          {cloudEnabled
            ? t(
                'Gli ascolti vengono salvati anche online, così telefono e PC mostrano gli stessi dati. La cronologia importata su un dispositivo arriva anche sugli altri.',
              )
            : t(
                'Sincronizzazione online non configurata: i dati restano solo su questo dispositivo. Per attivarla segui la sezione «Telefono e PC sincronizzati» del README.',
              )}
        </Text>
        {cloudEnabled && (
          <Text style={styles.meta}>
            {lastCloudSyncAt
              ? t('Ultima sincronizzazione online: {date}', { date: formatDateTime(lastCloudSyncAt) })
              : t('Non ancora sincronizzato')}
          </Text>
        )}
      </Section>

      <Section title={t('Diagnostica')}>
        <Text style={styles.text}>
          {t(
            'Se qualcosa non funziona, l’app annota l’errore su questo dispositivo. Non viene inviato niente: puoi leggere il registro e condividerlo con chi gestisce l’app.',
          )}
        </Text>
        <Text style={styles.meta}>
          {errorCount === 0
            ? t('Nessun errore registrato.')
            : plural(errorCount, '{n} errore registrato.', '{n} errori registrati.')}
        </Text>
        <Link href="/errors" asChild>
          <Tap style={[styles.button, { backgroundColor: colors.cardAlt }]} accessibilityRole="button">
            <Text style={[styles.buttonText, { color: colors.text }]}>{t('Apri il registro errori')}</Text>
          </Tap>
        </Link>
      </Section>

      <Section title={t('Account')}>
        {registration && (
          <Text style={styles.text}>
            {t('Registrato come')} <Text style={styles.step}>{registration.email}</Text>
          </Text>
        )}
        <Text style={styles.meta} selectable>
          Redirect URI: {redirectUri}
        </Text>
        <Button label={t('Esci da Spotify')} onPress={onLogout} danger />
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {hint && <Text style={styles.meta}>{hint}</Text>}
    </View>
  );
}

/** A row of options, one selected: the app's version of a segmented control. */
function Choice<T extends string | number>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.choice} accessibilityRole="radiogroup">
      {props.options.map((o) => {
        const active = o.value === props.value;
        return (
          <Tap
            key={String(o.value)}
            onPress={() => props.onChange(o.value)}
            style={[styles.option, active && styles.optionActive]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.optionText, active && styles.optionTextActive]}>{o.label}</Text>
          </Tap>
        );
      })}
    </View>
  );
}

function Button(props: { label: string; onPress: () => void; loading?: boolean; primary?: boolean; danger?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const bg = props.primary ? colors.accent : colors.cardAlt;
  const fg = props.primary ? colors.onAccent : props.danger ? colors.danger : colors.text;
  return (
    <Tap
      onPress={props.onPress}
      disabled={props.loading}
      style={[styles.button, { backgroundColor: bg }]}
      accessibilityRole="button"
    >
      {props.loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{props.label}</Text>}
    </Tap>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    content: { ...contentColumn, padding: 16, gap: 16, paddingBottom: 32 },
    section: { backgroundColor: colors.card, borderRadius: radius.md, padding: 16, gap: 10 },
    sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
    text: { color: colors.muted, lineHeight: 20 },
    step: { color: colors.text, lineHeight: 20 },
    link: { color: colors.accent, fontWeight: '600' },
    meta: { color: colors.muted, fontSize: 12, lineHeight: 17 },
    error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
    field: { gap: 8 },
    fieldLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    choice: { flexDirection: 'row', backgroundColor: colors.cardAlt, borderRadius: 999, padding: 4 },
    option: { flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: 'center' },
    optionActive: { backgroundColor: colors.accent },
    optionText: { color: colors.muted, fontWeight: '600', fontSize: 14 },
    optionTextActive: { color: colors.onAccent },
    button: { borderRadius: 999, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
    buttonText: { fontWeight: '700', fontSize: 15 },
  }),
);
