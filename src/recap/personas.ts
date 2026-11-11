import { formatNumber } from '@/lib/format';
import { msg, t } from '@/lib/i18n';
import type { PartOfDay, Personality, YearRecap } from '@/lib/recap';

import { pct, type IconName } from './helpers';

// Titles and sentences are Italian keys (msg): show them with t().

/** Who you are by the time of day you listen most. `share` has a {percent} placeholder. */
export const PERSONAS: Record<PartOfDay, { title: string; text: string; share: string; icon: IconName }> = {
  mattina: {
    title: msg('Mattiniero'),
    text: msg('La tua musica parte presto: la mattina è il tuo momento.'),
    share: msg('Il {percent} dei tuoi minuti è di mattina.'),
    icon: 'sunny',
  },
  pomeriggio: {
    title: msg('Colonna sonora del pomeriggio'),
    text: msg('Ascolti soprattutto di pomeriggio.'),
    share: msg('Il {percent} dei tuoi minuti è di pomeriggio.'),
    icon: 'partly-sunny',
  },
  sera: {
    title: msg('Anima della sera'),
    text: msg('Il grosso degli ascolti arriva dopo cena.'),
    share: msg('Il {percent} dei tuoi minuti è di sera.'),
    icon: 'moon',
  },
  notte: {
    title: msg('Nottambulo'),
    text: msg('Quando gli altri dormono, tu premi play.'),
    share: msg('Il {percent} dei tuoi minuti è di notte.'),
    icon: 'star',
  },
};

/** What kind of listener you are. `text` is already translated. */
export const PERSONALITIES: Record<Personality, { title: string; icon: IconName; text: (r: YearRecap) => string }> = {
  repeat: {
    title: msg('Fan del repeat'),
    icon: 'repeat',
    text: (r) =>
      t('Quando una canzone ti prende non la molli più: in media hai ascoltato ogni brano {n} volte.', {
        n: formatNumber(r.streams / Math.max(1, r.uniqueTracks)),
      }),
  },
  fedele: {
    title: msg('Fedelissimo'),
    icon: 'heart',
    text: (r) =>
      t('I tuoi 5 artisti preferiti si prendono il {percent} dei tuoi minuti. Squadra che vince non si cambia.', {
        percent: pct(r.top5Share),
      }),
  },
  esploratore: {
    title: msg('Esploratore'),
    icon: 'compass',
    text: (r) =>
      t('Hai scoperto {n} artisti mai ascoltati prima: il {percent} di quelli dell’anno.', {
        n: formatNumber(r.newArtists),
        percent: pct(r.newArtists / Math.max(1, r.uniqueArtists)),
      }),
  },
  eclettico: {
    title: msg('Eclettico'),
    icon: 'shuffle',
    text: (r) =>
      t('Ti muovi tra {n} artisti diversi senza fermarti troppo su nessuno.', { n: formatNumber(r.uniqueArtists) }),
  },
};
