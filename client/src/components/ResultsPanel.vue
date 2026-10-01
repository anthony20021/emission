<script setup>
import { ref, computed } from 'vue';
import { store, actions, me, opponent } from '../store.js';
import { buildMarks, buildLines, markStyle } from '../transcript.js';

const room = computed(() => store.room);
const round = computed(() => room.value.round);
const result = computed(() => round.value.result);
const lastRound = computed(() => round.value.number >= round.value.total);

const marks = computed(() => buildMarks(result.value, room.value.players));
const lines = computed(() => buildLines(result.value.tokens));

const cards = computed(() => room.value.players.map((player) => ({
  player,
  ...(result.value.scores[player.id] ?? { words: [], points: 0 }),
})));

const replayEl = ref(null);
const replaying = ref(false);

function replay() {
  const el = replayEl.value;
  const { url, start, end } = round.value.video;
  if (!el.src) el.src = url;
  el.currentTime = start;
  replaying.value = true;
  el.play().catch(() => (replaying.value = false));
  const stop = () => {
    if (el.currentTime >= end) {
      el.pause();
      replaying.value = false;
      el.removeEventListener('timeupdate', stop);
    }
  };
  el.addEventListener('timeupdate', stop);
}
</script>

<template>
  <section class="card panel results">
    <p class="eyebrow">Résultats de la manche {{ round.number }}</p>
    <h2 class="show-title small">{{ round.title }}</h2>

    <div class="result-cards">
      <div v-for="card in cards" :key="card.player.id" class="result-card" :style="{ '--player': card.player.color }">
        <div class="result-head">
          <span>{{ card.player.name }}</span>
          <strong>+{{ card.points }}</strong>
        </div>
        <ul class="result-words">
          <li v-for="w in card.words" :key="w.word" :class="{ hit: w.hit }">
            <span class="mark">{{ w.hit ? '✓' : '✗' }}</span>
            {{ w.word }}
            <small v-if="w.occurrences.length > 1">dit {{ w.occurrences.length }} fois</small>
          </li>
          <li v-if="card.words.length === 0" class="muted">Pas de mots validés à temps</li>
        </ul>
      </div>
    </div>

    <div class="transcript">
      <div class="transcript-head">
        <h3>Ce qui a été dit</h3>
        <button class="btn ghost small" :disabled="replaying" @click="replay">{{ replaying ? 'Lecture…' : "↺ Revoir l'extrait" }}</button>
      </div>
      <video ref="replayEl" class="replay" :class="{ visible: replaying }" playsinline preload="none"></video>
      <p v-for="line in lines" :key="line.seg" class="transcript-line">
        <template v-for="item in line.items" :key="item.index">{{ item.glue ? '' : ' ' }}{{ item.lead }}<span :class="{ marked: marks.has(item.index) }" :style="markStyle(marks.get(item.index))">{{ item.core }}</span>{{ item.trail }}</template>
      </p>
      <p class="muted small">Transcription automatique : quelques erreurs sont possibles.</p>
    </div>

    <div class="choose-actions">
      <button v-if="!me?.wantsNext" class="btn primary big" @click="actions.next()">
        {{ lastRound ? 'Voir le résultat final' : 'Manche suivante' }}
      </button>
      <p v-else class="waiting"><span class="pulse"></span> En attente de {{ opponent?.name ?? 'ton adversaire' }}…</p>
    </div>
  </section>
</template>
