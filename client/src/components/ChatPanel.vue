<script setup>
import { ref, watch, nextTick, onMounted } from 'vue';
import { store, actions } from '../store.js';

const text = ref('');
const list = ref(null);

const scrollDown = () => nextTick(() => {
  if (list.value) list.value.scrollTop = list.value.scrollHeight;
});
watch(() => store.chat.length, scrollDown);
onMounted(scrollDown);

function send() {
  const message = text.value.trim();
  if (!message) return;
  actions.say(message);
  text.value = '';
}

const time = (ts) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
</script>

<template>
  <aside class="card chat">
    <h3>Tchat</h3>
    <div ref="list" class="chat-list">
      <p v-if="store.chat.length === 0" class="muted small">Dis bonjour 👋</p>
      <div
        v-for="m in store.chat"
        :key="m.id"
        class="chat-msg"
        :class="{ system: m.system, mine: m.playerId === store.room?.you }"
      >
        <template v-if="m.system">{{ m.text }}</template>
        <template v-else>
          <span class="chat-author" :style="{ color: m.color }">{{ m.name }}</span>
          <span class="chat-time">{{ time(m.ts) }}</span>
          <div class="chat-text">{{ m.text }}</div>
        </template>
      </div>
    </div>
    <form class="chat-form" @submit.prevent="send">
      <input v-model="text" maxlength="300" placeholder="Écris un message…" autocomplete="off" />
      <button class="btn small" :disabled="!text.trim()">Envoyer</button>
    </form>
  </aside>
</template>
