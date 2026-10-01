// Environnement Python partagé par les scripts npm (transcription, téléchargement).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIR = path.join(ROOT, 'transcription');
const VENV = path.join(DIR, '.venv');
const isWindows = process.platform === 'win32';
export const venvPython = path.join(VENV, isWindows ? 'Scripts/python.exe' : 'bin/python');

export const run = (cmd, args, options = {}) => spawnSync(cmd, args, { stdio: 'inherit', ...options });
const works = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;

function findPython() {
  const candidates = isWindows ? [['py', ['-3']], ['python', []]] : [['python3', []], ['python', []]];
  return candidates.find(([cmd, args]) => works(cmd, [...args, '--version']));
}

const pip = (...pkgs) => run(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', ...pkgs]).status === 0;

/** Crée le venv au premier lancement, puis installe les dépendances manquantes. */
export function ensureVenv(modules) {
  if (!fs.existsSync(venvPython)) {
    const python = findPython();
    if (!python) {
      console.error('Python 3 est introuvable. Installe-le depuis https://www.python.org/downloads/ puis relance.');
      process.exit(1);
    }
    console.log("Première utilisation : création de l'environnement Python (quelques minutes)…");
    const [cmd, args] = python;
    if (run(cmd, [...args, '-m', 'venv', VENV]).status !== 0) process.exit(1);
    if (works('nvidia-smi', [])) {
      console.log('GPU NVIDIA détecté : installation des librairies CUDA…');
      if (!pip('-r', path.join(DIR, 'requirements-gpu.txt'))) console.warn('CUDA non installé : transcription sur CPU.');
    }
  }
  if (!works(venvPython, ['-c', `import ${modules.join(', ')}`])) {
    if (!pip('-r', path.join(DIR, 'requirements.txt'))) process.exit(1);
  }
}
