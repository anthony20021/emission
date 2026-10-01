<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { store, actions, serverNow } from '../store.js';
import { buildMarks, buildLines, markStyle } from '../transcript.js';

const VOLUME_KEY = 'motdit:volume';

const room = computed(() => store.room);
const round = computed(() => room.value.round);
const clip = computed(() => round.value.video);
const result = computed(() => round.value.result);
const playing = computed(() => room.value.phase === 'playing');

const videoEl = ref(null);
const time = ref(clip.value.start); // position dans la vidéo (s)
const countdown = ref(null);
const blocked = ref(false); // lecture auto refusée par le navigateur
const ended = ref(false);
const volume = ref(readVolume());
const popups = ref([]);

function readVolume() {
  try {
    return Number(localStorage.getItem(VOLUME_KEY) ?? 1);
  } catch {
    return 1;
  }
}

let readySent = false;
let startTimer = null;
let frame = null;

// --- Chargement : on se place au début de l'extrait et on prévient le serveur ---

function checkReady() {
  const el = videoEl.value;
  if (readySent || !el || el.readyState < 3) return;
  if (Math.abs(el.currentTime - clip.value.start) > 0.5) return;
  readySent = true;
  actions.clipReady();
}

function onMetadata() {
  // Page rechargée en pleine lecture : on reprend directement au bon moment.
  if (playing.value && serverNow() >= round.value.playAt) startPlayback();
  else videoEl.value.currentTime = clip.value.start;
}

// --- Lecture synchronisée ---

async function startPlayback() {
  const el = videoEl.value;
  if (!el || ended.value) return;
  const offset = (serverNow() - round.value.playAt) / 1000;
  const target = clip.value.start + Math.max(0, offset);
  if (target >= clip.value.end) {
    ended.value = true;
    return;
  }
  if (Math.abs(el.currentTime - target) > 0.25) el.currentTime = target;
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
    if (playing.value && round.value.playAt) {
      const left = round.value.playAt - serverNow();
      countdown.value = left > 0 ? Math.ceil(left / 1000) : null;
    }
    if (!el.paused) {
      time.value = el.currentTime;
      if (el.currentTime >= clip.value.end) {
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
      <video ref="videoEl" playsinline preload="auto" @loadedmetadata="onMetadata" @seeked="checkReady" @canplay="checkReady"></video>

      <div v-if="!playing" class="screen-overlay">
        <span class="pulse"></span> Chargement de l'extrait…
      </div>
      <div v-else-if="countdown" class="screen-overlay countdown">
        <Transition name="pop" mode="out-in"><span :key="countdown">{{ countdown }}</span></Transition>
      </div>
      <button v-else-if="blocked" class="screen-overlay clickable" @click="startPlayback">
        ▶ Clique pour lancer le son
      </button>
      <div v-else-if="ended" class="screen-overlay soft">Fin de l'extrait… résultats !</div>

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
