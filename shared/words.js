// Normalisation et comparaison des mots, partagé entre le serveur et le client.
//
// Le jeu est oral : on compare ce que le joueur a écrit avec ce que Whisper a
// transcrit. On est donc tolérant sur tout ce qui ne s'entend pas :
//   - accents, majuscules, ponctuation        ("Été" = "ete")
//   - pluriel en s/x                          ("chat" = "chats", "cheval" ≠ "chevaux")
//   - élisions et traits d'union              ("homme" trouvé dans "l'homme")
//   - nombres écrits en chiffres              ("vingt" = "20", "22" = "vingt-deux")

export const WORDS_PER_PLAYER = 3;
const MAX_PARTS = 4;
const MAX_LENGTH = 30;

// Mots trop fréquents pour être intéressants (sinon tout le monde joue "de", "le", "est"...).
// Écrits sans accents, comme après normalisation.
const STOPWORD_LIST = `
le la les l un une des du de d au aux ce cet cette ces mon ma mes ton ta tes son sa ses
notre nos votre vos leur leurs quel quelle quels quelles tout toute tous toutes chaque
quelque quelques plusieurs aucun aucune autre autres meme memes
je j me m moi tu t te toi il ils elle elles on nous vous se s soi lui eux y en c ca cela ceci
celui celle ceux celles qui que qu quoi dont ou lequel laquelle lesquels duquel auquel
a dans par pour sur sous avec sans chez vers entre contre depuis pendant avant apres devant
derriere jusque jusqu selon parmi
et mais donc or ni car si comme quand lorsque puisque parce
ne n pas plus moins tres trop bien mal peu beaucoup assez aussi encore deja toujours jamais
rien personne alors puis ici oui non ainsi tant tellement vraiment juste
etre suis es est sommes etes sont etais etait etions etiez etaient ete serai sera seront
serais serait soit sois soient fut
avoir ai as avons avez ont avais avait avions aviez avaient eu aura aurai auront aurais aurait ait aie
aller vais vas va allons allez vont allait allais alle
faire fais fait faisons faites font faisait fera
dire dis dit disons dites disent disait
peux peut pouvons pouvez peuvent pouvait pourrait pu
veux veut voulons voulez veulent voulait voudrais
sais sait savons savez savoir su vois voit voir vu faut fallait faudrait
euh heu hein ben bah bon ouais ok okay voila voici quoi enfin genre truc bref hum mh ah oh eh he ha
cest jai ya quil quils quon sil ny nest dun dune lon
`;
export const STOPWORDS = new Set(STOPWORD_LIST.split(/\s+/).filter(Boolean));

// --- Nombres -> lettres (orthographe rectifiée : traits d'union partout) ---

const UNITS = ['zero', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante', 8: 'quatre-vingt' };

function below100(n) {
  if (n <= 16) return UNITS[n];
  if (n < 20) return 'dix-' + UNITS[n - 10];
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  if (tens === 7) return unit === 1 ? 'soixante-et-onze' : 'soixante-' + below100(10 + unit);
  if (tens === 9) return 'quatre-vingt-' + below100(10 + unit);
  if (unit === 0) return tens === 8 ? 'quatre-vingts' : TENS[tens];
  if (unit === 1 && tens !== 8) return TENS[tens] + '-et-un';
  return TENS[tens] + '-' + UNITS[unit];
}

function below1000(n) {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return below100(rest);
  const head = hundreds === 1 ? 'cent' : UNITS[hundreds] + '-cent' + (rest === 0 ? 's' : '');
  return rest === 0 ? head : head + '-' + below100(rest);
}

export function numberToFrench(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n >= 1_000_000) return String(value);
  if (n < 1000) return below1000(n);
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const head = thousands === 1 ? 'mille' : below1000(thousands) + '-mille';
  return rest === 0 ? head : head + '-' + below1000(rest);
}

// --- Normalisation ---

export function normalizeText(text) {
  return String(text)
    .toLowerCase()
    .replace(/[’‘`´ʼ]/g, "'")
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function numbersToWords(text) {
  // "70 000", "3,5", "2024"
  return text.replace(/\d+(?:\s\d{3})*(?:[.,]\d+)?/g, (num) => {
    const [int, dec] = num.split(/[.,]/);
    const words = numberToFrench(int.replace(/\s/g, ''));
    return dec ? `${words}-virgule-${numberToFrench(dec)}` : words;
  });
}

// Découpe un mot en morceaux : "Aujourd'hui" -> ["aujourd", "hui"], "22" -> ["vingt", "deux"].
export function splitParts(text) {
  const cleaned = numbersToWords(normalizeText(text)).replace(/[^a-z0-9'\- ]+/g, ' ');
  return cleaned.split(/[\s'\-]+/).filter(Boolean);
}

// À l'oral, le s/x final du pluriel ne s'entend pas.
export function stem(word) {
  return word.length > 3 && /[sx]$/.test(word) ? word.slice(0, -1) : word;
}

// --- Mots des joueurs ---

/**
 * Valide un mot proposé par un joueur.
 * @returns {{ ok: true, word: string, key: string, parts: string[] } | { ok: false, error: string }}
 */
export function parsePlayerWord(raw, { banCommonWords = true } = {}) {
  const word = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!word) return { ok: false, error: 'Mot vide' };
  if (word.length > MAX_LENGTH) return { ok: false, error: 'Mot trop long' };
  if (/[^\p{L}\d'’\- ]/u.test(word)) return { ok: false, error: 'Lettres uniquement' };

  const parts = splitParts(word);
  if (parts.length === 0) return { ok: false, error: 'Mot vide' };
  if (parts.length > MAX_PARTS) return { ok: false, error: 'Un seul mot (ou expression courte)' };

  const compact = parts.join('');
  if (compact.length < 2) return { ok: false, error: 'Trop court' };

  if (banCommonWords && parts.every((p) => STOPWORDS.has(p) || STOPWORDS.has(stem(p)))) {
    return { ok: false, error: 'Mot trop courant' };
  }
  return { ok: true, word, key: stem(compact), parts };
}

/**
 * Valide la liste de mots d'un joueur (doublons compris).
 * @returns {{ words: Array<string|null>, errors: Array<string|null>, valid: Array<{word,key,parts}> }}
 */
export function parsePlayerWords(list, options) {
  const seen = new Set();
  const errors = [];
  const valid = [];
  for (let i = 0; i < WORDS_PER_PLAYER; i++) {
    const raw = list?.[i];
    if (!raw || !String(raw).trim()) {
      errors.push(null);
      continue;
    }
    const parsed = parsePlayerWord(raw, options);
    if (!parsed.ok) {
      errors.push(parsed.error);
    } else if (seen.has(parsed.key)) {
      errors.push('Déjà choisi');
    } else {
      seen.add(parsed.key);
      errors.push(null);
      valid.push(parsed);
    }
  }
  return { errors, valid };
}

// --- Transcription ---

// Whisper découpe "70 000" en deux mots "70" et "000" : on les recolle.
function mergeDigitGroups(words) {
  const merged = [];
  for (const word of words) {
    const prev = merged[merged.length - 1];
    if (prev && /^\d{1,3}(?: \d{3})*$/.test(prev.w) && /^\d{3}(?!\d)/.test(word.w)) {
      merged[merged.length - 1] = { ...prev, w: `${prev.w} ${word.w}`, e: word.e };
    } else {
      merged.push(word);
    }
  }
  return merged;
}

/**
 * Prépare les mots d'une transcription pour la recherche.
 * @param {Array<{w: string, s: number, e: number}>} words
 */
export function tokenize(words) {
  const tokens = [];
  for (const { w, s, e, seg } of mergeDigitGroups(words)) {
    const parts = splitParts(w);
    if (parts.length === 0) continue;
    const compact = parts.join('');
    // Whisper coupe "aujourd'hui" en "aujourd" + "'hui" : le 2e morceau est "collé" au précédent.
    const glued = /^['’\-]/.test(w.trim());
    tokens.push({ text: w, start: s, end: e, seg, glued, compact, key: stem(compact), partKeys: parts.map(stem) });
  }
  return tokens;
}

/**
 * Cherche les occurrences d'un mot de joueur dans une liste de tokens.
 * - mot simple ("homme") : un token entier, un morceau de token ("l'homme"),
 *   ou un mot que Whisper a coupé ("aujourd" + "'hui" pour "aujourdhui").
 * - expression ("tapis rouge", "vingt deux") : 1 à 4 tokens consécutifs collés,
 *   pour tolérer "tapis rouge" / "tapis-rouge" / "22".
 * @returns {Array<{ start: number, end: number, from: number, to: number }>}
 */
export function findOccurrences(playerWord, tokens) {
  const hits = [];
  const multi = playerWord.parts.length > 1;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!multi && (token.key === playerWord.key || token.partKeys.includes(playerWord.key))) {
      hits.push({ start: token.start, end: token.end, from: i, to: i });
      continue;
    }
    let joined = '';
    for (let j = i; j < Math.min(tokens.length, i + MAX_PARTS); j++) {
      // Un mot simple ne se recolle qu'aux morceaux collés (sinon "mais on" = "maison").
      if (!multi && j > i && !tokens[j].glued) break;
      joined += tokens[j].compact;
      if (stem(joined) === playerWord.key) {
        hits.push({ start: token.start, end: tokens[j].end, from: i, to: j });
        break;
      }
      if (joined.length >= playerWord.key.length + 1) break;
    }
  }
  return hits;
}
