<script setup>
import { computed } from 'vue';
import { store, actions } from '../store.js';
import Scoreboard from './Scoreboard.vue';
import LobbyPanel from './LobbyPanel.vue';
import ChoosePanel from './ChoosePanel.vue';
import ClipPanel from './ClipPanel.vue';
import ResultsPanel from './ResultsPanel.vue';
import FinalPanel from './FinalPanel.vue';
import ChatPanel from './ChatPanel.vue';

const room = computed(() => store.room);
const panel = computed(() => {
  switch (room.value.phase) {
    case 'choosing': return ChoosePanel;
    case 'loading':
    case 'playing': return ClipPanel;
    case 'results': return ResultsPanel;
    case 'finished': return FinalPanel;
    default: return LobbyPanel;
  }
});
// Une nouvelle instance de panneau par manche (remet le lecteur vidéo à zéro).
const panelKey = computed(() => `${room.value.phase === 'playing' ? 'loading' : room.value.phase}-${room.value.round?.number ?? 0}`);
</script>

<template>
  <main class="room">
    <div class="room-main">
      <div class="room-bar">
        <div class="room-meta">
          <span class="chip">Code <strong>{{ room.code }}</strong></span>
          <span v-if="room.round && room.phase !== 'lobby'" class="chip">
            Manche <strong>{{ room.round.number }}</strong> / {{ room.round.total }}
          </span>
        </div>
        <button class="btn ghost small" @click="actions.leave()">Quitter</button>
      </div>
      <Scoreboard />
      <component :is="panel" :key="panelKey" />
    </div>
    <ChatPanel class="room-chat" />
  </main>
</template>
