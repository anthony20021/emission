<script setup>
import { store } from './store.js';
import HomeScreen from './components/HomeScreen.vue';
import RoomScreen from './components/RoomScreen.vue';
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="logo"><span class="logo-mark">📺</span> Mot <em>Dit</em> !</div>
      <div class="net" :class="{ off: !store.connected }">
        <span class="dot"></span>{{ store.connected ? 'En ligne' : 'Connexion…' }}
      </div>
    </header>
    <RoomScreen v-if="store.room" />
    <HomeScreen v-else />
  </div>
</template>
