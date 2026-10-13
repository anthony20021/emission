<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { store, actions, serverNow } from '../store.js';
import { buildMarks, buildLines, markStyle } from '../transcript.js';

const VOLUME_KEY = 'motdit:volume';
const READY_AHEAD = 12; // secondes d'extrait en mémoire avant de se déclarer prêt (évite les coupures)
const PATIENCE_MS = 15_000; // au-delà, on se contente de ce que le navigateur a chargé
const MAX_RETRIES = 2;
const MAX_DRIFT = 1; // retard toléré sur l'autre joueur (s) avant de se recaler

const room = computed(() => store.room);
const round = computed(() => room.value.round);
const clip = computed(() => round.value.video);
const result = computed(() => round.value.result);
const playing = computed(() => room.value.phase === 'playing');
// Le serveur envoie en général un fichier qui ne contient que l'extrait : sa seconde 0 correspond
// à l'instant `offset` de l'émission. Toute la logique raisonne en temps de l'émission.
const offset = computed(() => clip.value.offset ?? 0);
const videoTime = () => videoEl.value.currentTime + offset.value;
const seekTo = (t) => {
  videoEl.value.currentTime = Math.max(0, t - offset.value);
};

const videoEl = ref(null);
const time = ref(clip.value.start); // position dans la vidéo (s)
const countdown = ref(null);
const blocked = ref(false); // lecture auto refusée par le navigateur
const ended = ref(false);
const volume = ref(readVolume());
const popups = ref([]);
const loadPct = ref(0); // part de l'extrait déjà en mémoire
const buffering = ref(false); // la lecture attend des données
const failed = ref(false); // vidéo illisible malgré les nouvelles tentatives

function readVolume() {
  try {
    return Number(localStorage.getItem(VOLUME_KEY) ?? 1);
  } catch {
    return 1;
  }
}

let readySent = false;
let suspended = false; // le navigateur a arrêté de télécharger de lui-même (il estime en avoir assez)
let retries = 0;
let sentStep = -1;
let loadStarted = 0;
let startTimer = null;
let frame = null;

// --- Chargement : on se place au début de l'extrait et on attend d'en avoir assez en mémoire ---

/** Secondes d'extrait déjà téléchargées à partir du début de l'extrait. */
function bufferedAhead() {
  const el = videoEl.value;
  const { start, end } = clip.value;
  for (let i = 0; i < el.buffered.length; i++) {
    const from = el.buffered.start(i) + offset.value;
    const to = el.buffered.end(i) + offset.value;
    if (from <= start + 0.3 && to > start) return Math.min(to, end) - start;
  }
  return 0;
}

function sendReady() {
  if (readySent) return;
  readySent = true;
  loadPct.value = 100;
  actions.clipReady();
}

function checkReady() {
  const el = videoEl.value;
  if (readySent || !el || el.readyState < 1) return;
  if (Math.abs(videoTime() - clip.value.start) > 0.5) return;

  const needed = Math.min(READY_AHEAD, clip.value.end - clip.value.start);
  const ahead = bufferedAhead();
  loadPct.value = Math.min(100, Math.round((ahead / needed) * 100));
  // L'autre joueur voit notre progression (par paliers de 10 % pour ne pas inonder le serveur).
  const step = Math.floor(loadPct.value / 10);
  if (step !== sentStep) {
    sentStep = step;
    actions.clipProgress(loadPct.value);
  }

  const canPlay = el.readyState >= 3;
  if (ahead >= needed - 0.05
    || (canPlay && suspended)
    || (canPlay && Date.now() - loadStarted > PATIENCE_MS)) {
    sendReady();
  }
}

function onSuspend() {
  suspended = true;
  checkReady();
}

// Un "suspend" reçu avant d'arriver au début de l'extrait ne compte pas.
function onSeeking() {
  suspended = false;
}

function onMetadata() {
  // Page rechargée (ou vidéo rechargée après une erreur) en pleine lecture : on reprend au bon moment.
  if (playing.value && serverNow() >= round.value.playAt) startPlayback();
  else seekTo(clip.value.start);
}

// Erreur réseau ou de lecture : on recharge la vidéo (2 fois), puis on abandonne sans bloquer la partie.
function onError() {
  if (retries < MAX_RETRIES) {
    retries++;
    suspended = false;
    setTimeout(() => {
      const el = videoEl.value;
      if (!el) return;
      el.src = `${clip.value.url}?essai=${retries}`;
      el.load();
    }, 1000 * retries);
    return;
  }
  failed.value = true;
  sendReady();
}

// La lecture a dû s'arrêter pour charger : une fois repartie, on rattrape l'autre joueur.
function onWaiting() {
  if (playing.value && !ended.value) buffering.value = true;
}

function onPlaying() {
  buffering.value = false;
  const el = videoEl.value;
  if (!el || !round.value.playAt) return;
  const target = clip.value.start + (serverNow() - round.value.playAt) / 1000;
  if (target - videoTime() > MAX_DRIFT && target < clip.value.end) seekTo(target);
}

// --- Lecture synchronisée ---

async function startPlayback() {
  const el = videoEl.value;
  if (!el || ended.value || failed.value) return;
  const late = (serverNow() - round.value.playAt) / 1000;
  const target = clip.value.start + Math.max(0, late);
  if (target >= clip.value.end) {
    ended.value = true;
    return;
  }
  if (Math.abs(videoTime() - target) > 0.25) seekTo(target);
  try {
    await el.play();
    blocked.value = false;
  } catch {
    blocked.value = true;
  }
}

function schedule() {
  clearTimeout(startTimer);
  if (!playing.value || !round.value.playAt) return;
  const delay = round.value.playAt - serverNow();
  startTimer = setTimeout(startPlayback, Math.max(0, delay));
}

function loop() {
  const el = videoEl.value;
  if (el) {
    if (!playing.value) checkReady();
    if (playing.value && round.value.playAt) {
      const left = round.value.playAt - serverNow();
      countdown.value = left > 0 ? Math.ceil(left / 1000) : null;
    }
    if (failed.value && playing.value && round.value.playAt) {
      // Pas de vidéo : les sous-titres et les points avancent quand même, au rythme du serveur.
      const elapsed = Math.max(0, (serverNow() - round.value.playAt) / 1000);
      time.value = Math.min(clip.value.end, clip.value.start + elapsed);
    } else if (!el.paused) {
      time.value = videoTime();
      if (time.value >= clip.value.end) {
        el.pause();
        ended.value = true;
        time.value = clip.value.end;
      }
    }
  }
  frame = requestAnimationFrame(loop);
}

watch(playing, schedule);
watch(volume, (v) => {
  if (videoEl.value) videoEl.value.volume = v;
  try {
    localStorage.setItem(VOLUME_KEY, String(v));
  } catch {
    /* pas grave */
  }
});

onMounted(() => {
  const el = videoEl.value;
  el.volume = volume.value;
  loadStarted = Date.now();
  el.src = clip.value.url;
  el.load();
  schedule();
  frame = requestAnimationFrame(loop);
});

onUnmounted(() => {
  clearTimeout(startTimer);
  cancelAnimationFrame(frame);
  store.live = {};
  const el = videoEl.value;
  if (el) {
    el.pause();
    el.removeAttribute('src');
    el.load();
  }
});

// --- Mots trouvés en direct ---

const marks = computed(() => buildMarks(result.value, room.value.players));
const lines = computed(() => buildLines(result.value?.tokens ?? []));

const board = computed(() => room.value.players.map((player) => {
  const words = (result.value?.scores[player.id]?.words ?? []).map((w) => {
    const first = w.occurrences[0]?.time;
    const seen = w.occurrences.filter((o) => o.time <= time.value).length;
    return { ...w, found: first != null && first <= time.value, seen };
  });
  return { player, words, points: words.filter((w) => w.found).length };
}));

// Ne réagit qu'aux changements de points (pas à chaque image).
const livePoints = computed(() => Object.fromEntries(board.value.map((r) => [r.player.id, r.points])));
watch(() => JSON.stringify(livePoints.value), () => {
  for (const row of board.value) {
    if (row.points > (store.live[row.player.id] ?? 0)) {
      const id = Math.random();
      popups.value.push({ id, color: row.player.color, name: row.player.name });
      setTimeout(() => (popups.value = popups.value.filter((p) => p.id !== id)), 1600);
    }
  }
  store.live = livePoints.value;
});

// Sous-titres : la phrase en cours, mot par mot.
const currentLine = computed(() => {
  const t = time.value;
  let current = null;
  for (const line of lines.value) {
    if (line.items[0].start <= t + 0.05) current = line;
  }
  return current;
});
</script>

<template>
  <section class="card panel clip">
    <div class="clip-head">
      <div>
        <p class="eyebrow">Extrait de</p>
        <h2 class="show-title small">{{ round.title }}</h2>
      </div>
      <label class="volume" title="Volume">
        🔊 <input v-model.number="volume" type="range" min="0" max="1" step="0.05" />
      </label>
    </div>

    <div class="screen">
      <video
        ref="videoEl"
        playsinline
        preload="auto"
        @loadedmetadata="onMetadata"
        @seeking="onSeeking"
        @seeked="checkReady"
        @canplay="checkReady"
        @progress="checkReady"
        @suspend="onSuspend"
        @error="onError"
        @waiting="onWaiting"
        @playing="onPlaying"
      ></video>

      <div v-if="failed && !ended" class="screen-overlay soft failed">
        Impossible de lire la vidéo (connexion ou navigateur).<br />
        <small>Les sous-titres et les points continuent quand même.</small>
      </div>
      <div v-else-if="!playing" class="screen-overlay loading">
        <span><span class="pulse"></span> Chargement de l'extrait… {{ loadPct }} %</span>
        <div class="load-bar"><div :style="{ transform: `scaleX(${loadPct / 100})` }"></div></div>
      </div>
      <div v-else-if="countdown" class="screen-overlay countdown">
        <Transition name="pop" mode="out-in"><span :key="countdown">{{ countdown }}</span></Transition>
      </div>
      <button v-else-if="blocked" class="screen-overlay clickable" @click="startPlayback">
        ▶ Clique pour lancer le son
      </button>
      <div v-else-if="ended" class="screen-overlay soft">Fin de l'extrait… résultats !</div>
      <div v-if="buffering && playing && !countdown && !ended" class="buffering"><span class="pulse"></span> Connexion lente…</div>

      <div v-if="playing && currentLine && !countdown" class="subtitles">
        <template v-for="item in currentLine.items" :key="item.index">
          <span class="sub-word" :class="{ hidden: item.start > time }">{{ item.glue ? '' : ' ' }}{{ item.lead }}</span>
          <span
            class="sub-word"
            :class="{ hidden: item.start > time, marked: marks.has(item.index) }"
            :style="item.start <= time ? markStyle(marks.get(item.index)) : null"
          >{{ item.core }}</span>
          <span v-if="item.trail" class="sub-word" :class="{ hidden: item.start > time }">{{ item.trail }}</span>
        </template>
      </div>

      <TransitionGroup name="float" tag="div" class="popups">
        <div v-for="p in popups" :key="p.id" class="popup" :style="{ '--player': p.color }">+1 {{ p.name }}</div>
      </TransitionGroup>

      <div class="progress">
        <div :style="{ transform: `scaleX(${Math.min(1, (time - clip.start) / (clip.end - clip.start))})` }"></div>
      </div>
    </div>

    <div class="bets">
      <div v-for="row in board" :key="row.player.id" class="bet-row" :style="{ '--player': row.player.color }">
        <span class="bet-name">{{ row.player.name }}</span>
        <span v-for="w in row.words" :key="w.word" class="word-chip" :class="{ found: w.found }">
          {{ w.word }}<b v-if="w.seen > 1"> ×{{ w.seen }}</b>
        </span>
        <span v-if="row.words.length === 0" class="muted small">aucun mot</span>
      </div>
    </div>
  </section>
</template>
