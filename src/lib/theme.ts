import { useColorScheme } from 'react-native';

import { useSettings, type ThemePref } from './settings';

export const darkColors = {
  bg: '#0E0F12',
  card: '#181A20',
  cardAlt: '#20232B',
  border: '#2A2E38',
  text: '#F4F5F7',
  muted: '#9AA0AE',
  accent: '#4ADE80',
  accentDim: 'rgba(74, 222, 128, 0.14)',
  /** Text and icons on top of the accent color. */
  onAccent: '#06210F',
  warn: '#FBBF24',
  warnDim: 'rgba(251, 191, 36, 0.12)',
  danger: '#F87171',
  /** Text of the purple "past years" chips on Home. */
  recapChip: '#E9D5FF',
  /** Calendar squares, from a little to a lot of listening. */
  heat: ['rgba(74, 222, 128, 0.25)', 'rgba(74, 222, 128, 0.45)', 'rgba(74, 222, 128, 0.7)', '#4ADE80'],
};

export type Colors = typeof darkColors;

export const lightColors: Colors = {
  bg: '#F4F5F8',
  card: '#FFFFFF',
  cardAlt: '#E9ECF1',
  border: '#D5D9E2',
  text: '#14161A',
  muted: '#5B6270',
  accent: '#15803D',
  accentDim: 'rgba(21, 128, 61, 0.12)',
  onAccent: '#FFFFFF',
  warn: '#B45309',
  warnDim: 'rgba(180, 83, 9, 0.10)',
  danger: '#DC2626',
  recapChip: '#6D28D9',
  heat: ['rgba(21, 128, 61, 0.25)', 'rgba(21, 128, 61, 0.45)', 'rgba(21, 128, 61, 0.7)', '#15803D'],
};

export const radius = { sm: 8, md: 14, lg: 20 };

/** Keeps content readable on wide PC windows: full width on phones, centered column on desktop. */
export const contentColumn = { width: '100%', maxWidth: 760, alignSelf: 'center' } as const;

/** "system" follows the phone or browser; the app was born dark, so that's the fallback. */
export function resolveDark(pref: ThemePref, system: string | null | undefined) {
  return pref === 'system' ? system !== 'light' : pref === 'dark';
}

export function useTheme(): { colors: Colors; dark: boolean } {
  const { theme } = useSettings();
  const dark = resolveDark(theme, useColorScheme());
  return { colors: dark ? darkColors : lightColors, dark };
}

/**
 * Styles that depend on the theme: `const useStyles = makeStyles((colors) => StyleSheet.create({ … }))`,
 * then `const styles = useStyles()` inside the component. Each theme is built once.
 */
export function makeStyles<T>(factory: (colors: Colors) => T): () => T {
  let dark: T | null = null;
  let light: T | null = null;
  return function useStyles() {
    const theme = useTheme();
    if (theme.dark) return (dark ??= factory(darkColors));
    return (light ??= factory(lightColors));
  };
}
