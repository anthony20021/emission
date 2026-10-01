// npm run check-clip [-- "Titre de la vidéo"] : tire un extrait comme le jeu, le re-transcrit à part
// (à partir du son découpé) et compare avec les mots que le jeu croit entendre.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { loadLibrary, VIDEOS_DIR } from '../server/library.js';
import { pickClip, tokensInClip } from '../server/clips.js';
import { splitParts, stem } from '../shared/words.js';
import { DIR, ensureVenv, venvPython } from './venv.js';

const { videos } = await loadLibrary();
const filter = process.argv[2]?.toLowerCase();
const pool = filter ? videos.filter((v) => v.title.toLowerCase().includes(filter)) : videos;
if (pool.length === 0) {
  console.error('Aucune émission transcrite trouvée (npm run transcribe).');
  process.exit(1);
}
const video = pool[Math.floor(Math.random() * pool.length)];
const clip = pickClip(video);
const expected = tokensInClip(video.tokens, clip);
console.log(`Émission : ${video.title} (${Math.round(video.duration)} s)`);
console.log(`Extrait  : ${clip.start} s -> ${clip.end} s (${(clip.end - clip.start).toFixed(1)} s)`);
console.log(`Le jeu y voit ${expected.length} mots : ${expected.map((t) => t.text).join(' ').slice(0, 200)}…\n`);

ensureVenv(['faster_whisper']);
const result = spawnSync(venvPython, [path.join(DIR, 'verify_clip.py'), path.join(VIDEOS_DIR, video.id), clip.start, clip.end], {
  encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' },
});
const line = result.stdout.split('\n').find((l) => l.startsWith('@@'));
if (!line) {
  console.error(result.stderr.slice(-800));
  process.exit(1);
}
const heard = JSON.parse(line.slice(2));
const keys = (list) => list.flatMap((w) => splitParts(w)).map(stem).filter((k) => k.length > 2);
const gameKeys = keys(expected.map((t) => t.text));
const heardSet = new Set(keys(heard));
const found = gameKeys.filter((k) => heardSet.has(k));
const ratio = found.length / gameKeys.length;
console.log(`Re-transcription indépendante : ${heard.length} mots : ${heard.join(' ').slice(0, 200)}…`);
console.log(`\nMots du jeu retrouvés dans l'audio découpé : ${found.length}/${gameKeys.length} (${(ratio * 100).toFixed(0)} %)`);
console.log(ratio >= 0.9 ? 'OK : l\'extrait correspond bien à ce qui est dit.' : 'ATTENTION : écart important entre le jeu et l\'audio.');
process.exit(ratio >= 0.9 ? 0 : 2);
