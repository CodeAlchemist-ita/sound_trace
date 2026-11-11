import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { getMeta, insertPlays, removeApiPlaysUpTo, setMeta, type Play } from './db';
import { t } from './i18n';

/** "Extended streaming history" export (Streaming_History_Audio_*.json). */
type ExtendedEntry = {
  ts: string;
  ms_played: number;
  master_metadata_track_name: string | null;
  master_metadata_album_artist_name: string | null;
  master_metadata_album_album_name: string | null;
  spotify_track_uri: string | null;
};

/** Basic "Account data" export (StreamingHistory_music_*.json). Times are UTC. */
type BasicEntry = {
  endTime: string; // "2026-01-03 20:13"
  artistName: string;
  trackName: string;
  msPlayed: number;
};

export type ImportResult = { files: number; read: number; inserted: number };

export function parseHistory(json: unknown): Play[] {
  if (!Array.isArray(json)) throw new Error(t('Il file non è una cronologia di Spotify valida'));
  const plays: Play[] = [];
  for (const e of json as Record<string, unknown>[]) {
    if (typeof e.ts === 'string') {
      const x = e as unknown as ExtendedEntry;
      // Podcast episodes and audiobooks have no track name: skip them.
      if (!x.master_metadata_track_name || !x.master_metadata_album_artist_name) continue;
      plays.push({
        playedAt: Date.parse(x.ts),
        trackUri: x.spotify_track_uri,
        trackName: x.master_metadata_track_name,
        artist: x.master_metadata_album_artist_name,
        album: x.master_metadata_album_album_name,
        msPlayed: x.ms_played,
        imageUrl: null,
        source: 'import',
      });
    } else if (typeof e.endTime === 'string' && typeof e.trackName === 'string') {
      const x = e as unknown as BasicEntry;
      plays.push({
        playedAt: Date.parse(`${x.endTime.replace(' ', 'T')}:00Z`),
        trackUri: null,
        trackName: x.trackName,
        artist: x.artistName,
        album: null,
        msPlayed: x.msPlayed,
        imageUrl: null,
        source: 'import',
      });
    }
  }
  return plays.filter((p) => Number.isFinite(p.playedAt));
}

/** Lets the user pick one or more JSON files from their Spotify data export. */
export async function pickAndImportHistory(): Promise<ImportResult | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', '*/*'],
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (picked.canceled) return null;

  // One file at a time, so only one parsed file (~10 MB) is in memory at once.
  let read = 0;
  let inserted = 0;
  let latest = 0;
  for (const asset of picked.assets) {
    // On web the picker hands back a browser File; on phones we read the cached copy.
    const text = Platform.OS === 'web' && asset.file ? await asset.file.text() : await new File(asset.uri).text();
    const plays = parseHistory(JSON.parse(text));
    read += plays.length;
    for (const p of plays) if (p.playedAt > latest) latest = p.playedAt;
    inserted += await insertPlays(plays);
  }

  // The real data now covers this period: drop the API estimates that overlap it.
  if (latest > 0) {
    await removeApiPlaysUpTo(latest);
    const prev = Number((await getMeta('importedUntil')) ?? 0);
    await setMeta('importedUntil', String(Math.max(prev, latest)));
  }
  return { files: picked.assets.length, read, inserted };
}
