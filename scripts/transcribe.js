// npm run transcribe [-- options] : lance transcription/transcribe.py (installe l'environnement Python au besoin).
import path from 'node:path';
import { DIR, ensureVenv, run, venvPython } from './venv.js';

ensureVenv(['faster_whisper']);
const result = run(venvPython, [path.join(DIR, 'transcribe.py'), ...process.argv.slice(2)], {
  env: { ...process.env, PYTHONUTF8: '1' },
});
process.exit(result.status ?? 1);
