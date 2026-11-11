import type { Slide } from '../helpers';
import { artist } from './artist';
import { compare } from './compare';
import { daytime } from './daytime';
import { empty } from './empty';
import { first } from './first';
import { habits } from './habits';
import { intro } from './intro';
import { minutes } from './minutes';
import { month } from './month';
import { personality } from './personality';
import { song } from './song';
import { summary } from './summary';

/** The stories of a year, in the order they are told. To add one: a new file here, then a line below. */
export const SLIDES: Slide[] = [intro, minutes, first, artist, song, month, daytime, personality, habits, compare, summary];

/** A year without plays. */
export const EMPTY_SLIDES: Slide[] = [empty];
