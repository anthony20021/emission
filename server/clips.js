// Choix de l'extrait (20-30 s) et calcul des points.
import { findOccurrences } from '../shared/words.js';

export const CLIP_MIN = 20;
export const CLIP_MAX = 30;
const MIN_WORDS_PER_SECOND = 1.2; // évite les extraits de musique / silence
const START_PAD = 0.3;
const END_PAD = 0.4;

const round2 = (n) => Math.round(n * 100) / 100;
const midpoint = (token) => (token.start + token.end) / 2;

function shuffle(array, random) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export function tokensInClip(tokens, clip) {
  return tokens.filter((t) => midpoint(t) >= clip.start && midpoint(t) <= clip.end);
}

// Construit un extrait qui commence au début de la phrase `i` et finit entre deux mots,
// de préférence à la fin d'une phrase, avec une durée proche d'une cible tirée au hasard.
function buildClip(tokens, i, duration, random) {
  const target = CLIP_MIN + random() * (CLIP_MAX - CLIP_MIN);
  const start = Math.max(0, tokens[i].start - START_PAD, i > 0 ? tokens[i - 1].end : 0);

  let sentenceEnd = null;
  let wordEnd = null;
  let last = i;
  for (let j = i; j < tokens.length && tokens[j].end - start <= CLIP_MAX; j++) {
    last = j;
    const length = tokens[j].end - start;
    if (length < CLIP_MIN) continue;
    const distance = Math.abs(length - target);
    const endsSentence = j + 1 === tokens.length || tokens[j + 1].seg !== tokens[j].seg;
    if (endsSentence && (!sentenceEnd || distance < sentenceEnd.distance)) sentenceEnd = { j, distance };
    if (!wordEnd || distance < wordEnd.distance) wordEnd = { j, distance };
  }
  const j = (sentenceEnd ?? wordEnd)?.j ?? last;

  let end = tokens[j].end + END_PAD;
  if (j + 1 < tokens.length) end = Math.min(end, tokens[j + 1].start);
  end = Math.min(end, duration);
  if (end - start < CLIP_MIN) {
    if (start + CLIP_MIN > duration) return null;
    end = start + CLIP_MIN;
  }

  const clip = { start: round2(start), end: round2(end) };
  clip.density = tokensInClip(tokens, clip).length / (clip.end - clip.start);
  return clip;
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/**
 * Choisit un extrait au hasard dans une émission, en évitant les extraits déjà joués.
 * @returns {{ start: number, end: number } | null}
 */
export function pickClip(entry, { avoid = [], random = Math.random } = {}) {
  const { tokens, duration } = entry;
  const sentenceStarts = [];
  for (let i = 0; i < tokens.length; i++) {
    if (i === 0 || tokens[i].seg !== tokens[i - 1].seg) sentenceStarts.push(i);
  }

  let best = null;
  for (const i of shuffle(sentenceStarts, random)) {
    const clip = buildClip(tokens, i, duration, random);
    if (!clip || avoid.some((other) => overlaps(clip, other))) continue;
    if (clip.density >= MIN_WORDS_PER_SECOND) return { start: clip.start, end: clip.end };
    if (!best || clip.density > best.density) best = clip;
  }
  return best && { start: best.start, end: best.end };
}

/**
 * Compte les points de chaque joueur sur l'extrait.
 * @param {Array<{ id: string, words: Array<{word, key, parts}> }>} players
 */
export function scoreClip(entry, clip, players) {
  const tokens = tokensInClip(entry.tokens, clip);
  const scores = {};
  for (const player of players) {
    const words = player.words.map((parsed) => {
      const occurrences = findOccurrences(parsed, tokens);
      return {
        word: parsed.word,
        hit: occurrences.length > 0,
        occurrences: occurrences.map(({ start, from, to }) => ({ time: start, from, to })),
      };
    });
    scores[player.id] = { words, points: words.filter((w) => w.hit).length };
  }
  return {
    tokens: tokens.map((t) => ({ w: t.text, s: t.start, e: t.end, seg: t.seg })),
    scores,
  };
}
