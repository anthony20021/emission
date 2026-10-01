<script setup>
import { ref, computed } from 'vue';
import { store, actions, isHost } from '../store.js';

const room = computed(() => store.room);
const players = computed(() => room.value.players);
const ranking = computed(() => [...players.value].sort((a, b) => b.score - a.score));
const tie = computed(() => players.value.length === 2 && players.value[0].score === players.value[1].score);
const winner = computed(() => (tie.value ? null : ranking.value[0]));
const error = ref(null);

async function replay() {
  error.value = null;
  const res = await actions.start();
  if (!res.ok) error.value = res.error;
}
</script>

<template>
  <section class="card panel final">
    <p class="eyebrow">Fin de la partie</p>
    <h2 v-if="tie" class="final-title">Égalité !</h2>
    <h2 v-else class="final-title" :style="{ '--player': winner.color }">
      🏆 <span class="winner">{{ winner.name }}</span> gagne !
    </h2>

    <div class="table-wrap">
      <table class="history">
        <thead>
          <tr>
            <th>Manche</th>
            <th>Émission</th>
            <th v-for="p in players" :key="p.id" :style="{ color: p.color }">{{ p.name }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in room.history" :key="h.number">
            <td>{{ h.number }}</td>
            <td class="title-cell">{{ h.title }}</td>
            <td v-for="p in players" :key="p.id">{{ h.points[p.id] ?? 0 }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2">Total</td>
            <td v-for="p in players" :key="p.id"><strong>{{ p.score }}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="choose-actions">
      <template v-if="isHost">
        <button class="btn primary big" :disabled="players.length < 2" @click="replay">Rejouer</button>
        <button class="btn ghost" @click="actions.backToLobby()">Changer les réglages</button>
      </template>
      <p v-else class="muted">L'hôte peut relancer une partie.</p>
      <p v-if="error" class="error">{{ error }}</p>
    </div>
  </section>
</template>
