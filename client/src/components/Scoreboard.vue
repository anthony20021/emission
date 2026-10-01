<script setup>
import { computed } from 'vue';
import { store } from '../store.js';

const room = computed(() => store.room);

function status(player) {
  if (!player.connected) return { icon: '⚠', text: 'Déconnecté' };
  switch (room.value.phase) {
    case 'choosing': return player.locked ? { icon: '✓', text: 'Mots validés' } : { icon: '…', text: 'Réfléchit' };
    case 'loading': return player.ready ? { icon: '✓', text: 'Prêt' } : { icon: '…', text: 'Chargement' };
    case 'results': return player.wantsNext ? { icon: '✓', text: 'Prêt' } : null;
    default: return null;
  }
}

const score = (player) => player.score + (room.value.phase === 'playing' ? store.live[player.id] ?? 0 : 0);
</script>

<template>
  <div class="scoreboard">
    <div
      v-for="player in room.players"
      :key="player.id"
      class="score-card"
      :class="{ me: player.id === room.you, offline: !player.connected }"
      :style="{ '--player': player.color }"
    >
      <div class="score-name">
        {{ player.name }}
        <span v-if="player.id === room.you" class="tag">toi</span>
        <span v-if="player.id === room.hostId" class="tag">hôte</span>
      </div>
      <div class="score-value">
        <Transition name="bump" mode="out-in">
          <span :key="score(player)">{{ score(player) }}</span>
        </Transition>
        <small>pt{{ score(player) > 1 ? 's' : '' }}</small>
      </div>
      <div v-if="status(player)" class="score-status">{{ status(player).icon }} {{ status(player).text }}</div>
    </div>
    <div v-if="room.players.length < 2" class="score-card empty">
      <div class="score-name">En attente d'un adversaire…</div>
    </div>
  </div>
</template>
