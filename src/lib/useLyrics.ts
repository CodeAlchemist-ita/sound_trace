import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchLyrics, LyricsError, translateLyrics } from './lyrics';
import type { NowPlaying } from './nowPlaying';

// Nothing here is saved: it is React state, gone on track change or app reload.

export type LyricsState = { status: 'idle' | 'loading' | 'found' | 'instrumental' | 'not_found' | 'error'; text?: string };
export type TranslationState = { status: 'idle' | 'loading' | 'done' | 'error'; text?: string; errorCode?: string };
export type LyricsView = 'original' | 'translated' | 'both';

const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === 'AbortError';

export function useLyrics(track: NowPlaying | null) {
  const trackId = track?.trackId;
  const [lyrics, setLyrics] = useState<LyricsState>({ status: 'idle' });
  const [translation, setTranslation] = useState<TranslationState>({ status: 'idle' });
  const [view, setView] = useState<LyricsView>('original');

  // Progress updates replace `track` every poll: read it through refs, key effects on the id only.
  const trackRef = useRef(track);
  const idRef = useRef(trackId);
  const lyricsRef = useRef(lyrics);
  const translationRef = useRef(translation);
  useEffect(() => {
    trackRef.current = track;
    idRef.current = trackId;
    lyricsRef.current = lyrics;
    translationRef.current = translation;
  });
  const lyricsCtl = useRef<AbortController | null>(null);
  const transCtl = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    const meta = trackRef.current;
    lyricsCtl.current?.abort();
    transCtl.current?.abort();
    setTranslation({ status: 'idle' });
    setView('original');
    if (!meta) {
      setLyrics({ status: 'idle' });
      return;
    }
    const ctl = new AbortController();
    lyricsCtl.current = ctl;
    setLyrics({ status: 'loading' });
    fetchLyrics(meta, ctl.signal)
      .then((r) => {
        if (ctl.signal.aborted) return;
        setLyrics(r.status === 'found' ? { status: 'found', text: r.text } : { status: r.status });
      })
      .catch((e) => {
        if (isAbort(e) || ctl.signal.aborted) return;
        setLyrics({ status: 'error' });
      });
  }, []);

  useEffect(() => {
    // The ref-sync effect above runs first, so trackRef is current here.
    // Resetting and fetching when the song changes is exactly what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    return () => {
      lyricsCtl.current?.abort();
      transCtl.current?.abort();
    };
  }, [trackId, load]);

  const requestTranslation = useCallback(() => {
    const cur = translationRef.current;
    if (cur.status === 'done') {
      setView('translated');
      return;
    }
    if (cur.status === 'loading') return;
    const original = lyricsRef.current;
    if (original.status !== 'found' || !original.text) return;
    const forId = idRef.current;
    transCtl.current?.abort();
    const ctl = new AbortController();
    transCtl.current = ctl;
    setTranslation({ status: 'loading' });
    translateLyrics(original.text, ctl.signal)
      .then((text) => {
        if (ctl.signal.aborted || idRef.current !== forId) return;
        setTranslation({ status: 'done', text });
        setView('translated');
      })
      .catch((e) => {
        if (isAbort(e) || ctl.signal.aborted || idRef.current !== forId) return;
        setTranslation({ status: 'error', errorCode: e instanceof LyricsError ? e.code : 'failed' });
      });
  }, []);

  const hideTranslation = useCallback(() => setView('original'), []);

  /** Retries whatever failed: the translation if that failed, else the lyrics. */
  const retry = useCallback(() => {
    if (translationRef.current.status === 'error') {
      translationRef.current = { status: 'idle' };
      requestTranslation();
    } else {
      load();
    }
  }, [load, requestTranslation]);

  return {
    lyrics,
    translation,
    view,
    setView,
    showTranslation: translation.status === 'done' && view !== 'original',
    requestTranslation,
    hideTranslation,
    retry,
  };
}
