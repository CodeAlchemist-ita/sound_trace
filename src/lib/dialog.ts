import { Alert, Platform } from 'react-native';

import { cloudEnabled } from './cloudSync';
import { t } from './i18n';

// React Native's Alert does nothing on web: use the browser's dialogs there.

export function showMessage(title: string, message: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

/** Resolves to 'keep', 'wipe' or null if cancelled. */
export function askLogout(): Promise<'keep' | 'wipe' | null> {
  if (Platform.OS === 'web') {
    if (!window.confirm(t('Vuoi uscire da Spotify?'))) return Promise.resolve(null);
    const question = cloudEnabled
      ? t('Vuoi anche eliminare gli ascolti salvati, su questo computer e online? (Sul telefono resta la sua copia finché non esci anche lì.)')
      : t('Vuoi anche eliminare gli ascolti salvati su questo computer?');
    const wipe = window.confirm(`${question}\n\n${t('OK = elimina, Annulla = mantieni')}`);
    return Promise.resolve(wipe ? 'wipe' : 'keep');
  }
  return new Promise((resolve) =>
    Alert.alert(
      t('Esci'),
      cloudEnabled
        ? t('Vuoi tenere gli ascolti già salvati? Se li elimini, spariscono dal telefono e online (sul PC resta la sua copia).')
        : t('Vuoi tenere sul telefono gli ascolti già salvati?'),
      [
        { text: t('Annulla'), style: 'cancel', onPress: () => resolve(null) },
        { text: t('Esci ed elimina dati'), style: 'destructive', onPress: () => resolve('wipe') },
        { text: t('Esci e mantieni'), onPress: () => resolve('keep') },
      ],
    ),
  );
}

/** Yes/no question; `destructive` styles the confirm button red on phones. */
export function askConfirm(title: string, message: string, confirmLabel: string, destructive = false): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: t('Annulla'), style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ]),
  );
}
