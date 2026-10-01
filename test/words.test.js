import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlayerWord, parsePlayerWords, tokenize, findOccurrences, numberToFrench } from '../shared/words.js';

// Découpage réel produit par Whisper (élisions et milliers séparés).
const WORDS = [
  ['Bonsoir', 0], ['à', 1], ['tous', 2], ['journal', 3], ['de', 4], ['20', 5], ['heures.', 6],
  ['Aujourd', 7], ["'hui,", 8], ['l', 9], ["'actualité", 10], ['est', 11], ['chargée.', 12],
  ['Les', 13], ['pompiers', 14], ['plus', 15], ['de', 16], ['300', 17], ['fois.', 18],
  ['22', 19], ['ans', 20], ['devant', 21], ['70', 22], ['000', 23], ['spectateurs.', 24],
  ['un', 25], ['chat', 26], ['tapis', 27], ['rouge', 28], ['Élysée', 29],
].map(([w, s]) => ({ w, s, e: s + 0.5 }));

const tokens = tokenize(WORDS);
const count = (word) => {
  const parsed = parsePlayerWord(word);
  assert.ok(parsed.ok, `${word} devrait être valide : ${parsed.error}`);
  return findOccurrences(parsed, tokens).length;
};

test('accents et majuscules ignorés', () => {
  assert.equal(count('elysee'), 1);
  assert.equal(count('ACTUALITE'), 1);
  assert.equal(count('chargee'), 1);
});

test('pluriel toléré dans les deux sens', () => {
  assert.equal(count('pompier'), 1);
  assert.equal(count('chats'), 1);
  assert.equal(count('spectateur'), 1);
});

test('élisions découpées par Whisper', () => {
  assert.equal(count('actualité'), 1);
  assert.equal(count("l'actualité"), 1);
  assert.equal(count("aujourd'hui"), 1);
  assert.equal(count('aujourd’hui'), 1);
  assert.equal(count('aujourdhui'), 1);
});

test('expressions en plusieurs mots', () => {
  assert.equal(count('tapis rouge'), 1);
  assert.equal(count('tapis-rouge'), 1);
  assert.equal(parsePlayerWord('peut-être').ok, false);
});

test('nombres en chiffres ou en lettres', () => {
  assert.equal(count('vingt'), 2); // "20" et "22"
  assert.equal(count('vingt-deux'), 1);
  assert.equal(count('22'), 1);
  assert.equal(count('trois cents'), 1);
  assert.equal(count('mille'), 1); // "70 000"
  assert.equal(count('soixante-dix mille'), 1);
});

test('pas de faux positifs', () => {
  const maison = tokenize([{ w: 'mais', s: 0, e: 1 }, { w: 'on', s: 1, e: 2 }]);
  assert.equal(findOccurrences(parsePlayerWord('maison'), maison).length, 0);
  assert.equal(count('hui'), 1); // morceau de "aujourd'hui", comme "homme" dans "l'homme"
  assert.equal(count('lactualite'), 1);
  assert.equal(count('chien'), 0);
  assert.equal(count('heur'), 0);
  assert.equal(count('journaux'), 0);
});

test('mots trop courants refusés', () => {
  assert.equal(parsePlayerWord('les').ok, false);
  assert.equal(parsePlayerWord("c'est").ok, false);
  assert.equal(parsePlayerWord('Euh').ok, false);
  assert.equal(parsePlayerWord('les', { banCommonWords: false }).ok, true);
});

test('validation des 3 mots', () => {
  const { errors, valid } = parsePlayerWords(['Chat', 'chats', 'le']);
  assert.deepEqual(errors, [null, 'Déjà choisi', 'Mot trop courant']);
  assert.equal(valid.length, 1);
  assert.equal(parsePlayerWord('deux mots ok').ok, true);
  assert.equal(parsePlayerWord('un deux trois quatre cinq').ok, false);
  assert.equal(parsePlayerWord('<script>').ok, false);
});

test('nombres en lettres', () => {
  assert.equal(numberToFrench(0), 'zero');
  assert.equal(numberToFrench(21), 'vingt-et-un');
  assert.equal(numberToFrench(81), 'quatre-vingt-un');
  assert.equal(numberToFrench(99), 'quatre-vingt-dix-neuf');
  assert.equal(numberToFrench(2024), 'deux-mille-vingt-quatre');
});
