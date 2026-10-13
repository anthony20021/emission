// npm run compress [-- --force] : convertit les vidéos de media/videos au format léger du jeu (voir transcription/compress.py).
import path from 'node:path';
import { DIR, ensureVenv, run, venvPython } from './venv.js';

ensureVenv(['av', 'imageio_ffmpeg']);
const result = run(venvPython, [path.join(DIR, 'compress.py'), ...process.argv.slice(2)], {
  env: { ...process.env, PYTHONUTF8: '1' },
});
process.exit(result.status ?? 1);
