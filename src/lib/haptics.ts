import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { getSettings } from './settings';

// Short vibrations that confirm a touch. Phones only, and only if enabled in Settings.
// Failures are ignored: a missing vibration must never break the action it accompanies.

function run(android: Haptics.AndroidHaptics, ios: () => Promise<void>) {
  if (Platform.OS === 'web' || !getSettings().haptics) return;
  try {
    // On Android the system haptics need no permission and respect the user's settings.
    const p = Platform.OS === 'android' ? Haptics.performAndroidHapticsAsync(android) : ios();
    p.catch(() => undefined);
  } catch {
    // Native module missing (app built before expo-haptics was added).
  }
}

/** A selection changed or something was opened: chips, rows, tabs. */
export function hapticTap() {
  run(Haptics.AndroidHaptics.Keyboard_Tap, () => Haptics.selectionAsync());
}

/** An action finished well: import, sync, saved goal. */
export function hapticSuccess() {
  run(Haptics.AndroidHaptics.Confirm, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** An action failed or was refused. */
export function hapticError() {
  run(Haptics.AndroidHaptics.Reject, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
