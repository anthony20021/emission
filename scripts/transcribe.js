// npm run transcribe [-- options]
// Prépare l'environnement Python au premier lancement (venv + faster-whisper, + CUDA si GPU NVIDIA),
// puis lance transcription/transcribe.py avec les options données.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'transcription');
const VENV = path.join(DIR, '.venv');
const isWindows = process.platform === 'win32';
const venvPython = path.join(VENV, isWindows ? 'Scripts/python.exe' : 'bin/python');

const run = (cmd, args, options = {}) => spawnSync(cmd, args, { stdio: 'inherit', ...options });
const works = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;

function findPython() {
  const candidates = isWindows ? [['py', ['-3']], ['python', []]] : [['python3', []], ['python', []]];
  return candidates.find(([cmd, args]) => works(cmd, [...args, '--version']));
}

function setup() {
  const python = findPython();
  if (!python) {
    console.error('Python 3 est introuvable. Installe-le depuis https://www.python.org/downloads/ puis relance.');
    process.exit(1);
  }
  console.log('Première utilisation : création de l\'environnement Python (quelques minutes)…');
  const [cmd, args] = python;
  if (run(cmd, [...args, '-m', 'venv', VENV]).status !== 0) process.exit(1);
  const pip = (...pkgs) => run(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', ...pkgs]).status === 0;
  if (!pip('-r', path.join(DIR, 'requirements.txt'))) process.exit(1);
  if (works('nvidia-smi', [])) {
    console.log('GPU NVIDIA détecté : installation des librairies CUDA…');
    if (!pip('-r', path.join(DIR, 'requirements-gpu.txt'))) console.warn('CUDA non installé : la transcription se fera sur CPU.');
  }
}

if (!fs.existsSync(venvPython)) setup();

const result = run(venvPython, [path.join(DIR, 'transcribe.py'), ...process.argv.slice(2)], {
  env: { ...process.env, PYTHONUTF8: '1' },
});
process.exit(result.status ?? 1);
