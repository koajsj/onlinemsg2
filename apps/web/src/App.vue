<script setup>
import { ref, watch } from 'vue';
import AuthView from './components/AuthView.vue';
import ChatApp from './components/ChatApp.vue';
import './styles/base.css';

const SESSION_KEY = 'portal-session';

const loadSession = () => {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
};

const session = ref(loadSession());

watch(
  session,
  value => {
    if (value) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(value));
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  },
  { deep: true }
);

const handleAuthenticated = payload => {
  session.value = payload;
};

const handleLogout = () => {
  session.value = null;
};

const handleSessionUpdated = payload => {
  session.value = payload;
};
</script>

<template>
  <AuthView v-if="!session?.token" @authenticated="handleAuthenticated" />
  <ChatApp
    v-else
    :session="session"
    @logout="handleLogout"
    @session-updated="handleSessionUpdated"
  />
</template>
