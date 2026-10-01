import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { VIDEOS_DIR, loadLibrary } from './library.js';
import { registerGame } from './game.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 3000;

const app = express();

// Seules les vidéos sont publiques (pas les transcriptions, sinon on pourrait tricher).
// express.static gère les requêtes "Range" : le navigateur peut sauter directement au bon moment.
app.use('/media/videos', express.static(VIDEOS_DIR, { fallthrough: false, maxAge: '1h' }));

app.get('/api/library', async (_req, res) => {
  const { videos, missing, invalid } = await loadLibrary();
  res.json({ count: videos.length, titles: videos.map((v) => v.title), missing, invalid });
});

// Client compilé (npm run build). En développement, c'est Vite qui le sert.
if (fs.existsSync(DIST_DIR)) app.use(express.static(DIST_DIR));

const server = createServer(app);
registerGame(new Server(server));

server.listen(PORT, async () => {
  console.log(`Serveur de jeu sur http://localhost:${PORT}`);
  const { videos, missing, invalid } = await loadLibrary();
  console.log(`${videos.length} émission(s) jouable(s).`);
  if (missing.length) {
    console.log(`${missing.length} vidéo(s) sans transcription : ${missing.join(', ')}`);
    console.log('  -> lance "npm run transcribe" pour les préparer.');
  }
  if (invalid.length) console.log(`Ignorées (trop courtes ou transcription illisible) : ${invalid.join(', ')}`);
});
