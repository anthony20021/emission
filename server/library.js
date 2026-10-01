// Bibliothèque des émissions : vidéos de media/videos + transcriptions de media/transcripts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenize } from '../shared/words.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VIDEOS_DIR = path.join(ROOT, 'media', 'videos');
export const TRANSCRIPTS_DIR = path.join(ROOT, 'media', 'transcripts');
export const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm', '.mov']);
export const MIN_VIDEO_DURATION = 25;

const cache = new Map(); // fichier transcription -> { mtimeMs, entry }

async function readEntry(file, transcriptPath, mtimeMs) {
  const cached = cache.get(transcriptPath);
  if (cached?.mtimeMs === mtimeMs) return cached.entry;

  const data = JSON.parse(await fs.readFile(transcriptPath, 'utf8'));
  const words = data.segments.flatMap((segment, seg) => segment.words.map((word) => ({ ...word, seg })));
  const tokens = tokenize(words);
  const entry = {
    id: file,
    title: data.title || path.parse(file).name,
    url: `/media/videos/${encodeURIComponent(file)}`,
    duration: data.duration || tokens.at(-1)?.end || 0,
    tokens,
  };
  cache.set(transcriptPath, { mtimeMs, entry });
  return entry;
}

/**
 * Liste les émissions jouables (vidéo + transcription valide).
 * @returns {Promise<{ videos: object[], missing: string[], invalid: string[] }>}
 */
export async function loadLibrary() {
  let files = [];
  try {
    files = await fs.readdir(VIDEOS_DIR);
  } catch {
    return { videos: [], missing: [], invalid: [] };
  }

  const videos = [];
  const missing = [];
  const invalid = [];
  for (const file of files.sort()) {
    if (!VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    const transcriptPath = path.join(TRANSCRIPTS_DIR, `${path.parse(file).name}.json`);
    try {
      const stat = await fs.stat(transcriptPath);
      const entry = await readEntry(file, transcriptPath, stat.mtimeMs);
      if (entry.duration >= MIN_VIDEO_DURATION && entry.tokens.length > 0) videos.push(entry);
      else invalid.push(file);
    } catch (error) {
      if (error.code === 'ENOENT') missing.push(file);
      else invalid.push(file);
    }
  }
  return { videos, missing, invalid };
}
