<script setup>
import { ref, computed } from 'vue';
import { store, actions, isHost } from '../store.js';

const room = computed(() => store.room);
const settings = computed(() => room.value.settings);
const copied = ref(false);
const error = ref(null);
const starting = ref(false);

const inviteLink = computed(() => `${location.origin}${location.pathname}#${room.value.code}`);
const canStart = computed(() => isHost.value && room.value.players.length === 2 && room.value.players.every((p) => p.connected));

const ROUNDS = [3, 5, 7, 10];
const TIMES = [
  { value: 30, label: '30 s' },
  { value: 60, label: '1 min' },
  { value: 90, label: '1 min 30' },
  { value: 0, label: 'Illimité' },
];

async function copy() {
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    copied.value = false;
  }
}

function update(patch) {
  if (isHost.value) actions.updateSettings({ ...settings.value, ...patch });
}

async function start() {
  error.value = null;
  starting.value = true;
  const res = await actions.start();
  starting.value = false;
  if (!res.ok) error.value = res.error;
}
</script>

<template>
  <section class="card panel lobby">
    <div class="invite">
      <p class="eyebrow">Code de la partie</p>
      <div class="big-code">{{ room.code }}</div>
      <button class="btn small" @click="copy">{{ copied ? 'Lien copié !' : "Copier le lien d'invitation" }}</button>
    </div>

    <div class="settings">
      <h2>Réglages <span v-if="!isHost" class="muted small">(choisis par l'hôte)</span></h2>

      <div class="setting">
        <span>Nombre de manches</span>
        <div class="segmented">
          <button
            v-for="n in ROUNDS"
            :key="n"
            :class="{ active: settings.rounds === n }"
            :disabled="!isHost"
            @click="update({ rounds: n })"
          >{{ n }}</button>
        </div>
      </div>

      <div class="setting">
        <span>Temps pour choisir ses mots</span>
        <div class="segmented">
          <button
            v-for="t in TIMES"
            :key="t.value"
            :class="{ active: settings.choiceSeconds === t.value }"
            :disabled="!isHost"
            @click="update({ choiceSeconds: t.value })"
          >{{ t.label }}</button>
        </div>
      </div>

      <label class="setting toggle">
        <span>
          Interdire les mots trop courants
          <small class="muted">« le », « est », « euh », « voilà »…</small>
        </span>
        <input
          type="checkbox"
          :checked="settings.banCommonWords"
          :disabled="!isHost"
          @change="update({ banCommonWords: $event.target.checked })"
        />
      </label>
    </div>

    <div class="lobby-actions">
      <button v-if="isHost" class="btn primary big" :disabled="!canStart || starting" @click="start">
        {{ room.players.length < 2 ? 'En attente du 2e joueur…' : 'Lancer la partie' }}
      </button>
      <p v-else class="muted">L'hôte va lancer la partie…</p>
      <p v-if="error" class="error">{{ error }}</p>
    </div>
  </section>
</template>
