<script setup>
import { ref, computed, onMounted } from 'vue';
import { store, actions } from '../store.js';

const name = ref(store.name);
const code = ref(location.hash.slice(1).toUpperCase().slice(0, 4));
const error = ref(store.notice);
const busy = ref(false);
const library = ref(null);

const validName = computed(() => name.value.trim().length > 0);

onMounted(async () => {
  try {
    library.value = await (await fetch('/api/library')).json();
  } catch {
    library.value = null;
  }
});

async function run(action) {
  error.value = null;
  if (!validName.value) {
    error.value = "Choisis d'abord un pseudo.";
    return;
  }
  actions.setName(name.value.trim());
  busy.value = true;
  const res = await action();
  busy.value = false;
  if (!res.ok) error.value = res.error;
}

const create = () => run(() => actions.create());
const join = () => {
  if (code.value.trim().length < 4) {
    error.value = 'Entre le code à 4 caractères de la partie.';
    return;
  }
  run(() => actions.join(code.value.trim()));
};
</script>

<template>
  <main class="home">
    <section class="hero">
      <p class="eyebrow">Jeu à deux joueurs</p>
      <h1>Devine les mots<br />qui vont être <span class="accent">dits</span>.</h1>
      <p class="lead">
        On te donne le nom d'une émission. Tu paries sur 3 mots. Un extrait de 20 à 30 secondes se lance :
        chaque mot prononcé te rapporte 1 point.
      </p>
      <p v-if="library && library.count === 0" class="warning">
        Aucune émission prête. Mets des vidéos dans <code>media/videos</code> puis lance <code>npm run transcribe</code>.
      </p>
      <p v-else-if="library" class="muted small">{{ library.count }} émission{{ library.count > 1 ? 's' : '' }} disponible{{ library.count > 1 ? 's' : '' }}</p>
    </section>

    <section class="card home-card">
      <label class="field">
        <span>Ton pseudo</span>
        <input v-model="name" maxlength="20" placeholder="Ex : Jean-Pierre" autocomplete="nickname" @keyup.enter="create" />
      </label>

      <button class="btn primary big" :disabled="busy || !store.connected" @click="create">Créer une partie</button>

      <div class="separator"><span>ou rejoindre</span></div>

      <div class="join-row">
        <input
          v-model="code"
          class="code-input"
          maxlength="4"
          placeholder="CODE"
          autocapitalize="characters"
          spellcheck="false"
          @input="code = code.toUpperCase()"
          @keyup.enter="join"
        />
        <button class="btn" :disabled="busy || !store.connected" @click="join">Rejoindre</button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </main>
</template>
