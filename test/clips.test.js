import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, parsePlayerWords } from '../shared/words.js';
import { pickClip, scoreClip, tokensInClip, CLIP_MIN, CLIP_MAX } from '../server/clips.js';

// 3 minutes de parole : une phrase de 8 mots toutes les 4 s, puis 40 s de musique, puis reprise.
function fakeEntry() {
  const words = [];
  let seg = 0;
  for (let t = 0; t < 180; t += 4) {
    if (t >= 60 && t < 100) continue; // générique musical
    for (let k = 0; k < 8; k++) words.push({ w: k === 3 ? 'fromage' : `mot${seg}x${k}`, s: t + k * 0.45, e: t + k * 0.45 + 0.4, seg });
    seg++;
  }
  return { tokens: tokenize(words), duration: 180 };
}

test('les extraits durent entre 20 et 30 s et commencent en début de phrase', () => {
  const entry = fakeEntry();
  const starts = new Set(entry.tokens.filter((t, i) => i === 0 || t.seg !== entry.tokens[i - 1].seg).map((t) => t.start));
  for (let i = 0; i < 200; i++) {
    const clip = pickClip(entry);
    const length = clip.end - clip.start;
    assert.ok(length >= CLIP_MIN - 0.01 && length <= CLIP_MAX + 0.5, `durée ${length}`);
    const first = tokensInClip(entry.tokens, clip)[0];
    assert.ok(starts.has(first.start), 'commence en début de phrase');
  }
});

test('évite les passages sans parole', () => {
  const entry = fakeEntry();
  for (let i = 0; i < 200; i++) {
    const clip = pickClip(entry);
    const density = tokensInClip(entry.tokens, clip).length / (clip.end - clip.start);
    assert.ok(density >= 1.2, `densité ${density.toFixed(2)} pour ${clip.start}-${clip.end}`);
  }
});

test('ne rejoue pas un passage déjà entendu', () => {
  const entry = fakeEntry();
  const avoid = [];
  for (let i = 0; i < 4; i++) {
    const clip = pickClip(entry, { avoid });
    if (!clip) break;
    for (const other of avoid) assert.ok(clip.end <= other.start || clip.start >= other.end, 'pas de chevauchement');
    avoid.push(clip);
  }
  assert.ok(avoid.length >= 3);
});

test('1 point par mot trouvé, même s\'il est dit plusieurs fois', () => {
  const entry = fakeEntry();
  const clip = pickClip(entry);
  const players = [{ id: 'a', words: parsePlayerWords(['fromage', 'girafe', 'Fromages']).valid }];
  const { scores, tokens } = scoreClip(entry, clip, players);
  assert.equal(players[0].words.length, 2); // "Fromages" = doublon de "fromage"
  assert.equal(scores.a.points, 1);
  assert.ok(scores.a.words[0].occurrences.length >= 4);
  assert.ok(tokens.every((t) => (t.s + t.e) / 2 >= clip.start && (t.s + t.e) / 2 <= clip.end));
});
