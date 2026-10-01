// Salons de jeu à 2 joueurs + événements Socket.IO.
//
// Déroulé d'une manche :
//   choosing  -> chaque joueur voit le nom de l'émission et choisit 3 mots
//   loading   -> les mots sont verrouillés, les clients chargent la vidéo au début de l'extrait
//   playing   -> compte à rebours puis lecture synchronisée de l'extrait
//   results   -> points de la manche + transcription surlignée
// puis manche suivante, jusqu'à `finished`.
import { randomInt, randomUUID } from 'node:crypto';
import { parsePlayerWords, WORDS_PER_PLAYER } from '../shared/words.js';
import { loadLibrary } from './library.js';
import { pickClip, scoreClip } from './clips.js';

const MAX_PLAYERS = 2;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const PLAYER_COLORS = ['#38bdf8', '#f472b6'];
const NAME_MAX = 20;
const CHAT_MAX = 300;
const CHAT_HISTORY = 100;
const CHAT_RATE = { count: 5, windowMs: 5_000 };

const RECONNECT_GRACE_MS = 60_000;
const CHOICE_GRACE_MS = 1_500; // laisse le temps au client d'envoyer ses mots à la fin du chrono
const LOADING_TIMEOUT_MS = 20_000;
const COUNTDOWN_MS = 3_000;
const END_MARGIN_MS = 1_200;
const RESULTS_TIMEOUT_MS = 45_000;

export const SETTINGS_OPTIONS = {
  rounds: [3, 5, 7, 10],
  choiceSeconds: [30, 60, 90, 0], // 0 = illimité
};
const DEFAULT_SETTINGS = { rounds: 5, choiceSeconds: 60, banCommonWords: true };

const rooms = new Map();

function generateCode() {
  let code;
  do {
    code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(raw) {
  const name = String(raw ?? '').replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return name || null;
}

function cleanWords(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, WORDS_PER_PLAYER).map((w) => String(w ?? '').slice(0, 40));
}

class Room {
  constructor(io, code) {
    this.io = io;
    this.code = code;
    this.players = [];
    this.hostId = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.phase = 'lobby';
    this.round = null;
    this.history = [];
    this.chat = [];
    this.timer = null;
    this.library = [];
    this.usedVideos = new Set();
    this.usedClips = new Map(); // vidéo -> extraits déjà joués
  }

  // --- Joueurs ---

  addPlayer(name, socket) {
    const usedColors = new Set(this.players.map((p) => p.color));
    const player = {
      id: randomUUID(),
      token: randomUUID(),
      name,
      color: PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[0],
      socketId: null,
      connected: false,
      score: 0,
      draft: [],
      words: [],
      locked: false,
      ready: false,
      wantsNext: false,
      chatTimes: [],
      graceTimer: null,
    };
    this.players.push(player);
    if (!this.hostId) this.hostId = player.id;
    this.attach(player, socket);
    this.system(`${name} a rejoint la partie.`);
    return player;
  }

  attach(player, socket) {
    clearTimeout(player.graceTimer);
    player.graceTimer = null;
    player.socketId = socket.id;
    player.connected = true;
    socket.data.roomCode = this.code;
    socket.data.playerId = player.id;
    socket.join(this.code);
  }

  disconnect(player) {
    player.connected = false;
    player.socketId = null;
    this.system(`${player.name} s'est déconnecté…`);
    player.graceTimer = setTimeout(() => this.removePlayer(player, `${player.name} a quitté la partie.`), RECONNECT_GRACE_MS);
    this.checkProgress();
    this.broadcast();
  }

  reconnect(player, socket) {
    this.attach(player, socket);
    this.system(`${player.name} est de retour.`);
    this.broadcast();
  }

  removePlayer(player, message) {
    clearTimeout(player.graceTimer);
    this.players = this.players.filter((p) => p !== player);
    if (this.players.length === 0) {
      this.destroy();
      return;
    }
    if (this.hostId === player.id) this.hostId = this.players[0].id;
    this.system(message);
    if (this.phase !== 'lobby') {
      this.resetGame();
      this.system('Partie interrompue : retour au salon.');
    }
    this.broadcast();
  }

  destroy() {
    clearTimeout(this.timer);
    for (const player of this.players) clearTimeout(player.graceTimer);
    rooms.delete(this.code);
  }

  get activePlayers() {
    return this.players.filter((p) => p.connected);
  }

  // --- Chat ---

  pushChat(message) {
    const entry = { id: randomUUID(), ts: Date.now(), ...message };
    this.chat.push(entry);
    if (this.chat.length > CHAT_HISTORY) this.chat.shift();
    this.io.to(this.code).emit('chat:message', entry);
  }

  system(text) {
    this.pushChat({ system: true, text });
  }

  say(player, raw) {
    const text = String(raw ?? '').replace(/[\p{Cc}]/gu, '').trim().slice(0, CHAT_MAX);
    if (!text) return;
    const now = Date.now();
    player.chatTimes = player.chatTimes.filter((t) => now - t < CHAT_RATE.windowMs);
    if (player.chatTimes.length >= CHAT_RATE.count) return;
    player.chatTimes.push(now);
    this.pushChat({ playerId: player.id, name: player.name, color: player.color, text });
  }

  // --- Déroulé de la partie ---

  setTimer(ms, fn) {
    clearTimeout(this.timer);
    this.timer = ms == null ? null : setTimeout(fn, ms);
  }

  resetGame() {
    this.setTimer(null);
    this.phase = 'lobby';
    this.round = null;
    this.history = [];
    this.usedVideos.clear();
    this.usedClips.clear();
    for (const p of this.players) {
      p.score = 0;
      Object.assign(p, { draft: [], words: [], locked: false, ready: false, wantsNext: false });
    }
  }

  async start() {
    if (this.players.length < MAX_PLAYERS) throw new Error('Il faut 2 joueurs pour lancer la partie.');
    if (this.starting) return;
    this.starting = true;
    let videos;
    try {
      ({ videos } = await loadLibrary());
    } finally {
      this.starting = false;
    }
    if (videos.length === 0) {
      throw new Error('Aucune émission transcrite. Ajoute des vidéos dans media/videos puis lance "npm run transcribe".');
    }
    if (this.players.length < MAX_PLAYERS) throw new Error('Un joueur est parti.');
    this.resetGame();
    this.library = videos;
    this.system(`La partie commence : ${this.settings.rounds} manches !`);
    this.startRound(1);
  }

  // Priorité : une émission pas encore jouée, puis un passage pas encore entendu,
  // et en dernier recours (petite bibliothèque) un extrait qui recoupe un précédent.
  pickVideoAndClip() {
    const fresh = this.library.filter((v) => !this.usedVideos.has(v.id));
    const attempts = [[fresh, true], [this.library, true], [this.library, false]];
    for (const [pool, avoidPlayed] of attempts) {
      const candidates = [...pool].sort(() => Math.random() - 0.5);
      for (const video of candidates) {
        const clip = pickClip(video, { avoid: avoidPlayed ? this.usedClips.get(video.id) ?? [] : [] });
        if (clip) return { video, clip };
      }
    }
    return null;
  }

  startRound(number) {
    const pick = this.pickVideoAndClip();
    if (!pick) {
      this.system("Plus aucun extrait disponible : fin de la partie.");
      this.finish();
      return;
    }
    const { video, clip } = pick;
    this.usedVideos.add(video.id);
    this.usedClips.set(video.id, [...(this.usedClips.get(video.id) ?? []), clip]);

    for (const p of this.players) Object.assign(p, { draft: [], words: [], locked: false, ready: false, wantsNext: false });
    const seconds = this.settings.choiceSeconds;
    this.round = {
      number,
      video,
      clip,
      deadline: seconds ? Date.now() + seconds * 1000 : null,
      playAt: null,
      result: null,
    };
    this.phase = 'choosing';
    this.setTimer(seconds ? seconds * 1000 + CHOICE_GRACE_MS : null, () => this.closeChoices());
    this.system(`Manche ${number} : « ${video.title} »`);
    this.broadcast();
  }

  setDraft(player, words) {
    if (this.phase !== 'choosing' || player.locked) return;
    player.draft = cleanWords(words);
  }

  lock(player, words) {
    if (this.phase !== 'choosing') return { ok: false, error: 'Trop tard !' };
    const draft = cleanWords(words);
    const { errors, valid } = parsePlayerWords(draft, this.settings);
    if (valid.length < WORDS_PER_PLAYER) {
      return { ok: false, errors: errors.map((e, i) => e ?? (draft[i]?.trim() ? null : 'Mot manquant')) };
    }
    Object.assign(player, { draft, words: valid, locked: true });
    if (this.players.every((p) => p.locked)) this.closeChoices();
    else this.broadcast();
    return { ok: true };
  }

  unlock(player) {
    if (this.phase !== 'choosing' || !player.locked) return;
    player.locked = false;
    player.words = [];
    this.broadcast();
  }

  // Fin du choix (tout le monde a validé, ou chrono écoulé : on prend les mots valides du brouillon).
  closeChoices() {
    if (this.phase !== 'choosing') return;
    for (const p of this.players) {
      if (!p.locked) {
        p.words = parsePlayerWords(p.draft, this.settings).valid;
        p.locked = true;
      }
    }
    const { video, clip } = this.round;
    this.round.result = scoreClip(video, clip, this.players);
    this.phase = 'loading';
    for (const p of this.players) p.ready = false;
    this.setTimer(LOADING_TIMEOUT_MS, () => this.play());
    this.broadcast();
  }

  setReady(player) {
    if (this.phase !== 'loading') return;
    player.ready = true;
    this.checkProgress();
    this.broadcast();
  }

  play() {
    if (this.phase !== 'loading') return;
    const { clip } = this.round;
    this.phase = 'playing';
    this.round.playAt = Date.now() + COUNTDOWN_MS;
    this.setTimer(COUNTDOWN_MS + (clip.end - clip.start) * 1000 + END_MARGIN_MS, () => this.showResults());
    this.broadcast();
  }

  showResults() {
    if (this.phase !== 'playing') return;
    const { result, video, number } = this.round;
    for (const p of this.players) {
      p.score += result.scores[p.id]?.points ?? 0;
      p.wantsNext = false;
    }
    this.history.push({
      number,
      title: video.title,
      points: Object.fromEntries(this.players.map((p) => [p.id, result.scores[p.id]?.points ?? 0])),
    });
    this.phase = 'results';
    this.setTimer(RESULTS_TIMEOUT_MS, () => this.nextRound());
    this.broadcast();
  }

  wantNext(player) {
    if (this.phase !== 'results') return;
    player.wantsNext = true;
    this.checkProgress();
    this.broadcast();
  }

  nextRound() {
    if (this.phase !== 'results') return;
    if (this.round.number >= this.settings.rounds) this.finish();
    else this.startRound(this.round.number + 1);
  }

  finish() {
    this.setTimer(null);
    this.phase = 'finished';
    const [a, b] = this.players;
    if (a && b) {
      this.system(a.score === b.score ? 'Égalité parfaite !' : `${(a.score > b.score ? a : b).name} remporte la partie !`);
    }
    this.broadcast();
  }

  // Avance si tous les joueurs connectés sont prêts (un joueur déconnecté ne bloque pas la partie).
  checkProgress() {
    const active = this.activePlayers;
    if (active.length === 0) return;
    if (this.phase === 'loading' && active.every((p) => p.ready)) this.play();
    if (this.phase === 'results' && active.every((p) => p.wantsNext)) this.nextRound();
  }

  updateSettings(raw) {
    if (this.phase !== 'lobby' && this.phase !== 'finished') return;
    const next = { ...this.settings };
    if (SETTINGS_OPTIONS.rounds.includes(raw?.rounds)) next.rounds = raw.rounds;
    if (SETTINGS_OPTIONS.choiceSeconds.includes(raw?.choiceSeconds)) next.choiceSeconds = raw.choiceSeconds;
    if (typeof raw?.banCommonWords === 'boolean') next.banCommonWords = raw.banCommonWords;
    this.settings = next;
    this.broadcast();
  }

  // --- État envoyé aux clients ---

  stateFor(viewer) {
    const revealed = ['loading', 'playing', 'results'].includes(this.phase);
    const round = this.round;
    return {
      code: this.code,
      phase: this.phase,
      you: viewer.id,
      hostId: this.hostId,
      settings: this.settings,
      serverNow: Date.now(),
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        connected: p.connected,
        score: p.score,
        locked: p.locked,
        ready: p.ready,
        wantsNext: p.wantsNext,
        words: p.id === viewer.id || revealed ? p.words.map((w) => w.word) : null,
        draft: p.id === viewer.id ? p.draft : null,
      })),
      round: round && {
        number: round.number,
        total: this.settings.rounds,
        title: round.video.title,
        deadline: round.deadline,
        video: revealed ? { url: round.video.url, start: round.clip.start, end: round.clip.end } : null,
        playAt: round.playAt,
        result: this.phase === 'playing' || this.phase === 'results' ? round.result : null,
      },
      history: this.history,
    };
  }

  broadcast() {
    for (const player of this.players) {
      if (player.connected) this.io.to(player.socketId).emit('room:state', this.stateFor(player));
    }
  }
}

// --- Événements Socket.IO ---

export function registerGame(io) {
  io.on('connection', (socket) => {
    const current = () => {
      const room = rooms.get(socket.data.roomCode);
      const player = room?.players.find((p) => p.id === socket.data.playerId);
      return room && player ? { room, player } : null;
    };

    const leaveCurrent = () => {
      const ctx = current();
      if (!ctx) return;
      socket.leave(ctx.room.code);
      socket.data.roomCode = null;
      socket.data.playerId = null;
      ctx.room.removePlayer(ctx.player, `${ctx.player.name} a quitté la partie.`);
    };

    const joined = (room, player) => ({
      ok: true,
      code: room.code,
      token: player.token,
      state: room.stateFor(player),
      chat: room.chat,
    });

    // Si le client n'envoie pas d'accusé de réception, on ignore la requête.
    const handler = (fn) => (payload, ack) => {
      if (typeof ack !== 'function') ack = () => {};
      try {
        const result = fn(payload ?? {});
        if (result instanceof Promise) result.then(ack, (error) => ack({ ok: false, error: error.message }));
        else ack(result ?? { ok: true });
      } catch (error) {
        ack({ ok: false, error: error.message });
      }
    };

    socket.on('time:sync', handler(() => ({ ok: true, now: Date.now() })));

    socket.on('room:create', handler(({ name }) => {
      const cleaned = cleanName(name);
      if (!cleaned) return { ok: false, error: 'Choisis un pseudo.' };
      leaveCurrent();
      const room = new Room(io, generateCode());
      rooms.set(room.code, room);
      const player = room.addPlayer(cleaned, socket);
      room.broadcast();
      return joined(room, player);
    }));

    socket.on('room:join', handler(({ name, code }) => {
      const cleaned = cleanName(name);
      if (!cleaned) return { ok: false, error: 'Choisis un pseudo.' };
      const room = rooms.get(String(code ?? '').trim().toUpperCase());
      if (!room) return { ok: false, error: 'Aucune partie avec ce code.' };
      if (room.players.length >= MAX_PLAYERS) return { ok: false, error: 'La partie est déjà complète.' };
      if (room.phase !== 'lobby') return { ok: false, error: 'La partie a déjà commencé.' };
      leaveCurrent();
      const player = room.addPlayer(cleaned, socket);
      room.broadcast();
      return joined(room, player);
    }));

    socket.on('room:rejoin', handler(({ code, token }) => {
      const room = rooms.get(String(code ?? '').toUpperCase());
      const player = room?.players.find((p) => p.token === token);
      if (!player) return { ok: false, error: 'Partie introuvable.' };
      // Même joueur ouvert dans un autre onglet : l'ancien est déconnecté sans prévenir le salon.
      const previous = player.socketId !== socket.id && io.sockets.sockets.get(player.socketId);
      if (previous) {
        previous.data.playerId = null;
        previous.disconnect(true);
      }
      room.reconnect(player, socket);
      return joined(room, player);
    }));

    socket.on('room:leave', handler(() => leaveCurrent()));

    const inRoom = (fn) => handler((payload) => {
      const ctx = current();
      if (!ctx) return { ok: false, error: "Tu n'es dans aucune partie." };
      return fn(ctx, payload);
    });
    const hostOnly = (fn) => inRoom((ctx, payload) => {
      if (ctx.room.hostId !== ctx.player.id) return { ok: false, error: "Seul l'hôte peut faire ça." };
      return fn(ctx, payload);
    });

    socket.on('room:settings', hostOnly(({ room }, payload) => room.updateSettings(payload)));
    socket.on('game:start', hostOnly(async ({ room }) => {
      if (room.phase !== 'lobby' && room.phase !== 'finished') return { ok: false, error: 'Partie déjà en cours.' };
      await room.start();
      return { ok: true };
    }));
    socket.on('game:lobby', hostOnly(({ room }) => {
      if (room.phase !== 'finished') return { ok: false };
      room.resetGame();
      room.broadcast();
    }));

    socket.on('words:draft', inRoom(({ room, player }, { words }) => room.setDraft(player, words)));
    socket.on('words:lock', inRoom(({ room, player }, { words }) => room.lock(player, words)));
    socket.on('words:unlock', inRoom(({ room, player }) => room.unlock(player)));
    socket.on('clip:ready', inRoom(({ room, player }) => room.setReady(player)));
    socket.on('round:next', inRoom(({ room, player }) => room.wantNext(player)));
    socket.on('chat:send', inRoom(({ room, player }, { text }) => room.say(player, text)));

    socket.on('disconnect', () => {
      const ctx = current();
      if (ctx && ctx.player.socketId === socket.id) ctx.room.disconnect(ctx.player);
    });
  });
}
