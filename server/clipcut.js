// Découpe de l'extrait côté serveur : au lieu de laisser le navigateur piocher 25 s dans un fichier
// d'une heure (dont l'index seul pèse 2 à 5 Mo), on fabrique un petit mp4 de ~1 Mo pour la manche.
// Réencodé en H.264 240p : lisible par tous les navigateurs, même si la source est en AV1.
// Nécessite ffmpeg (apt install ffmpeg, ou variable FFMPEG_PATH). Sans ffmpeg : vidéo complète, comme avant.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VIDEOS_DIR } from './library.js';

export const CLIPS_DIR = path.join(os.tmpdir(), 'motdit-clips');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const PAD = 0.5; // marge avant/après l'extrait (s)
const CUT_TIMEOUT_MS = 60_000;

export const ffmpegAvailable = spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' }).status === 0;

/** Vide le dossier des extraits (au démarrage du serveur). */
export function resetClipsDir() {
  fs.rmSync(CLIPS_DIR, { recursive: true, force: true });
  fs.mkdirSync(CLIPS_DIR, { recursive: true });
}

/**
 * Découpe [clip.start, clip.end] de la vidéo dans un fichier à part.
 * @returns {Promise<{ url: string, offset: number, file: string } | null>}
 *   offset = instant de la vidéo d'origine qui correspond au début du fichier découpé.
 */
export function cutClip(video, clip) {
  if (!ffmpegAvailable) return Promise.resolve(null);
  const from = Math.max(0, clip.start - PAD);
  const duration = clip.end + PAD - from;
  const name = `${randomUUID()}.mp4`;
  const file = path.join(CLIPS_DIR, name);
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', from.toFixed(3), '-i', path.join(VIDEOS_DIR, video.id), '-t', duration.toFixed(3),
    '-map', '0:v:0', '-map', '0:a:0',
    '-vf', "scale=-2:'min(240,ih)'", '-fpsmax', '30',
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-crf', '28',
    '-maxrate', '350k', '-bufsize', '700k', '-g', '50', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k', '-ac', '1',
    '-movflags', '+faststart', file,
  ];
  return new Promise((resolve) => {
    let errors = '';
    const child = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), CUT_TIMEOUT_MS);
    child.stderr.on('data', (chunk) => (errors += chunk));
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(file)) {
        resolve({ url: `/clips/${name}`, offset: from, file });
        return;
      }
      fs.rm(file, { force: true }, () => {});
      console.warn(`Découpe impossible (${video.title}) : ${errors.trim().split('\n').at(-1) ?? code}`);
      resolve(null);
    });
  });
}

export function removeClip(media) {
  if (media?.file) fs.rm(media.file, { force: true }, () => {});
}
