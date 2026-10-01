// État global du client : connexion Socket.IO, état du salon reçu du serveur, chat.
import { reactive, computed } from 'vue';
import { io } from 'socket.io-client';

const SESSION_KEY = 'motdit:session'; // par onglet : 2 onglets = 2 joueurs
const NAME_KEY = 'motdit:name';
const CHAT_LIMIT = 200;

const storage = {
  get(area, key) {
    try {
      return JSON.parse(area.getItem(key));
    } catch {
      return null;
    }
  },
  set(area, key, value) {
    try {
      if (value == null) area.removeItem(key);
      else area.setItem(key, JSON.stringify(value));
    } catch {
      /* stockage indisponible : tant pis pour la reconnexion auto */
    }
  },
};

export const socket = io();

export const store = reactive({
  connected: false,
  name: storage.get(localStorage, NAME_KEY) ?? '',
  room: null,
  chat: [],
  clockOffset: 0,
  notice: null,
  live: {}, // points marqués en direct pendant l'extrait : { [playerId]: number }
});

/** Heure du serveur (ms), pour synchroniser le lancement de l'extrait entre les 2 joueurs. */
export const serverNow = () => Date.now() + store.clockOffset;

export const me = computed(() => store.room?.players.find((p) => p.id === store.room.you) ?? null);
export const opponent = computed(() => store.room?.players.find((p) => p.id !== store.room.you) ?? null);
export const isHost = computed(() => store.room?.hostId === store.room?.you);

function emit(event, payload = {}) {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (error, response) => {
      resolve(error ? { ok: false, error: 'Le serveur ne répond pas.' } : response ?? { ok: true });
    });
  });
}

async function syncClock() {
  let best = null;
  for (let i = 0; i < 5; i++) {
    const sent = Date.now();
    const res = await emit('time:sync');
    const received = Date.now();
    if (!res.ok) continue;
    const rtt = received - sent;
    if (!best || rtt < best.rtt) best = { rtt, offset: res.now + rtt / 2 - received };
  }
  if (best) store.clockOffset = best.offset;
}

function enterRoom(res) {
  store.room = res.state;
  store.chat = res.chat;
  store.notice = null;
  storage.set(sessionStorage, SESSION_KEY, { code: res.code, token: res.token });
  history.replaceState(null, '', `#${res.code}`);
}

function exitRoom(notice = null) {
  storage.set(sessionStorage, SESSION_KEY, null);
  store.room = null;
  store.chat = [];
  store.notice = notice;
  history.replaceState(null, '', location.pathname);
}

socket.on('connect', async () => {
  store.connected = true;
  syncClock();
  const session = storage.get(sessionStorage, SESSION_KEY);
  if (!session) return;
  const res = await emit('room:rejoin', session);
  if (res.ok) enterRoom(res);
  else exitRoom(store.room ? "La partie n'existe plus." : null);
});

socket.on('disconnect', () => {
  store.connected = false;
});

socket.on('room:state', (state) => {
  store.room = state;
});

socket.on('chat:message', (message) => {
  store.chat.push(message);
  if (store.chat.length > CHAT_LIMIT) store.chat.splice(0, store.chat.length - CHAT_LIMIT);
});

export const actions = {
  setName(name) {
    store.name = name;
    storage.set(localStorage, NAME_KEY, name);
  },
  async create() {
    const res = await emit('room:create', { name: store.name });
    if (res.ok) enterRoom(res);
    return res;
  },
  async join(code) {
    const res = await emit('room:join', { name: store.name, code });
    if (res.ok) enterRoom(res);
    return res;
  },
  async leave() {
    await emit('room:leave');
    exitRoom();
  },
  updateSettings: (settings) => emit('room:settings', settings),
  start: () => emit('game:start'),
  backToLobby: () => emit('game:lobby'),
  draft: (words) => socket.emit('words:draft', { words }),
  lock: (words) => emit('words:lock', { words }),
  unlock: () => emit('words:unlock'),
  clipReady: () => emit('clip:ready'),
  next: () => emit('round:next'),
  say: (text) => emit('chat:send', { text }),
};
