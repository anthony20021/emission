<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { store, actions, me, opponent, serverNow } from '../store.js';
import { parsePlayerWords, WORDS_PER_PLAYER } from '../../../shared/words.js';

const room = computed(() => store.room);
const round = computed(() => room.value.round);

const words = ref(Array.from({ length: WORDS_PER_PLAYER }, (_, i) => me.value?.draft?.[i] ?? ''));
const serverErrors = ref([]);
const busy = ref(false);
const inputs = ref([]);
const remaining = ref(null);

const locked = computed(() => me.value?.locked);
const check = computed(() => parsePlayerWords(words.value, room.value.settings));
const errors = computed(() => words.value.map((w, i) => (w.trim() ? check.value.errors[i] : null) ?? serverErrors.value[i] ?? null));
const complete = computed(() => check.value.valid.length === WORDS_PER_PLAYER);

// Brouillon envoyé au serveur : si le chrono tombe, ce sont ces mots qui comptent.
let draftTimer = null;
const sendDraft = () => {
  clearTimeout(draftTimer);
  actions.draft(words.value);
};
watch(words, () => {
  serverErrors.value = [];
  clearTimeout(draftTimer);
  draftTimer = setTimeout(sendDraft, 300);
}, { deep: true });

let tick = null;
let flushed = false;
function updateTimer() {
  if (!round.value.deadline) {
    remaining.value = null;
    return;
  }
  const ms = round.value.deadline - serverNow();
  remaining.value = Math.max(0, ms);
  if (ms < 1500 && !flushed && !locked.value) {
    flushed = true;
    sendDraft();
  }
}

onMounted(() => {
  updateTimer();
  tick = setInterval(updateTimer, 200);
  nextTick(() => inputs.value[0]?.focus());
});
onUnmounted(() => {
  clearInterval(tick);
  clearTimeout(draftTimer);
});

const timerLabel = computed(() => (remaining.value == null ? null : Math.ceil(remaining.value / 1000)));
const timerRatio = computed(() => {
  const total = room.value.settings.choiceSeconds * 1000;
  return total && remaining.value != null ? remaining.value / total : 1;
});

async function lock() {
  if (!complete.value || busy.value) return;
  busy.value = true;
  const res = await actions.lock(words.value);
  busy.value = false;
  if (!res.ok) serverErrors.value = res.errors ?? [];
}

function onEnter(index) {
  if (index < WORDS_PER_PLAYER - 1) inputs.value[index + 1]?.focus();
  else lock();
}
</script>

<template>
  <section class="card panel choose">
    <p class="eyebrow">L'émission</p>
    <h2 class="show-title">{{ round.title }}</h2>
    <p class="lead">Quels mots vont être prononcés dans l'extrait ?</p>

    <div v-if="timerLabel != null" class="timer" :class="{ urgent: timerLabel <= 10 }">
      <div class="timer-bar" :style="{ transform: `scaleX(${timerRatio})` }"></div>
      <span>{{ timerLabel }} s</span>
    </div>

    <div class="word-inputs">
      <div v-for="(_, i) in words" :key="i" class="word-input" :class="{ invalid: errors[i] }">
        <span class="word-index">{{ i + 1 }}</span>
        <input
          :ref="(el) => (inputs[i] = el)"
          v-model="words[i]"
          maxlength="30"
          :disabled="locked"
          :placeholder="['Un mot…', 'Un autre…', 'Le dernier !'][i]"
          spellcheck="false"
          autocomplete="off"
          @keyup.enter="onEnter(i)"
        />
        <span v-if="errors[i]" class="word-error">{{ errors[i] }}</span>
      </div>
    </div>

    <div class="choose-actions">
      <template v-if="!locked">
        <button class="btn primary big" :disabled="!complete || busy" @click="lock">Valider mes mots</button>
      </template>
      <template v-else>
        <p class="waiting">
          <span class="pulse"></span>
          {{ opponent?.locked ? 'C\'est parti !' : `En attente de ${opponent?.name ?? 'ton adversaire'}…` }}
        </p>
        <button class="btn ghost small" @click="actions.unlock()">Modifier</button>
      </template>
    </div>
  </section>
</template>
