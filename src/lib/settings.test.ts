import { DEFAULT_SETTINGS, getSettings, resetSettingsForTests, sanitizeSettings, updateSettings } from './settings';
import { darkColors, lightColors, resolveDark } from './theme';

beforeEach(() => resetSettingsForTests());

describe('sanitizeSettings', () => {
  it('keeps valid values', () => {
    const saved = { theme: 'light', language: 'en', minStreamSec: 60, weekStart: 'sunday', haptics: false };
    expect(sanitizeSettings(saved, DEFAULT_SETTINGS)).toEqual(saved);
  });

  it('replaces anything invalid with the fallback, one field at a time', () => {
    const saved = { theme: 'pink', language: 'en', minStreamSec: 45, weekStart: 3, haptics: 'yes', extra: true };
    expect(sanitizeSettings(saved, DEFAULT_SETTINGS)).toEqual({ ...DEFAULT_SETTINGS, language: 'en' });
  });

  it('survives a file that is not an object', () => {
    expect(sanitizeSettings(null, DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('dark', DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings([1, 2], DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('updateSettings', () => {
  it('changes only what was asked', async () => {
    await updateSettings({ theme: 'light' });
    expect(getSettings()).toEqual({ ...DEFAULT_SETTINGS, theme: 'light' });
  });

  it('refuses an invalid value and keeps the current one', async () => {
    await updateSettings({ minStreamSec: 60 });
    await updateSettings({ minStreamSec: 7 });
    expect(getSettings().minStreamSec).toBe(60);
  });
});

describe('the theme', () => {
  it('follows the system only when asked to', () => {
    expect(resolveDark('system', 'light')).toBe(false);
    expect(resolveDark('system', 'dark')).toBe(true);
    expect(resolveDark('dark', 'light')).toBe(true);
    expect(resolveDark('light', 'dark')).toBe(false);
  });

  it('is dark when the system does not say', () => {
    expect(resolveDark('system', null)).toBe(true);
    expect(resolveDark('system', undefined)).toBe(true);
  });

  it('defines the same colors in both themes', () => {
    expect(Object.keys(lightColors).sort()).toEqual(Object.keys(darkColors).sort());
    expect(lightColors.heat).toHaveLength(darkColors.heat.length);
  });
});
