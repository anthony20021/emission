// npm run download : télécharge des vidéos YouTube en mp4 dans media/videos (voir transcription/download.py).
import path from 'node:path';
import { DIR, ensureVenv, run, venvPython } from './venv.js';

ensureVenv(['yt_dlp', 'imageio_ffmpeg']);
const result = run(venvPython, [path.join(DIR, 'download.py'), ...process.argv.slice(2)], {
  env: { ...process.env, PYTHONUTF8: '1' },
});
process.exit(result.status ?? 1);
