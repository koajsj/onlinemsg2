<script setup>
import { reactive, ref } from 'vue';
import { apiRequest } from '../lib/api.js';
import { generateAndStoreUserKeys, hasPrivateKeyPackage, unlockPrivateKey } from '../lib/e2ee.js';

const emit = defineEmits(['authenticated']);

const mode = ref('login');
const loading = ref(false);
const error = ref('');
const hint = ref('');
const form = reactive({
  username: '',
  password: '',
  nickname: ''
});

const submit = async () => {
  loading.value = true;
  error.value = '';
  hint.value = '';

  try {
    if (mode.value === 'register') {
      const publicKey = await generateAndStoreUserKeys(form.username, form.password);
      const payload = await apiRequest('/auth/register', {
        method: 'POST',
        body: {
          username: form.username,
          password: form.password,
          nickname: form.nickname || form.username,
          publicKey
        }
      });
      emit('authenticated', payload);
      return;
    }

    const payload = await apiRequest('/auth/login', {
      method: 'POST',
      body: {
        username: form.username,
        password: form.password
      }
    });

    if (hasPrivateKeyPackage(form.username)) {
      try {
        await unlockPrivateKey(form.username, form.password);
      } catch (_error) {
        hint.value = '已登录，但本机加密私钥未解锁，进入后可重新输入密码解锁。';
      }
    } else {
      hint.value = '已登录，但当前设备没有本地私钥，历史加密消息需要补充密钥后才能解密。';
    }

    emit('authenticated', payload);
  } catch (submitError) {
    error.value = submitError.message;
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="auth-shell">
    <div class="auth-card">
      <div class="auth-brand">
        <p class="auth-eyebrow">257823.xyz</p>
        <h1>私有聊天</h1>
        <p>OpenIM 核心驱动，消息正文默认端到端加密。</p>
      </div>

      <div class="auth-switch">
        <button :class="{ active: mode === 'login' }" type="button" @click="mode = 'login'">登录</button>
        <button :class="{ active: mode === 'register' }" type="button" @click="mode = 'register'">注册</button>
      </div>

      <form class="auth-form" @submit.prevent="submit">
        <label>
          <span>账号</span>
          <input v-model.trim="form.username" autocomplete="username" maxlength="24" placeholder="仅限字母、数字、下划线" required>
        </label>

        <label v-if="mode === 'register'">
          <span>昵称</span>
          <input v-model.trim="form.nickname" maxlength="32" placeholder="显示名称">
        </label>

        <label>
          <span>密码</span>
          <input v-model="form.password" autocomplete="current-password" minlength="8" type="password" placeholder="至少 8 位，需包含字母和数字" required>
        </label>

        <p v-if="error" class="form-error">{{ error }}</p>
        <p v-if="hint" class="form-hint">{{ hint }}</p>

        <button class="primary-button" :disabled="loading" type="submit">
          {{ loading ? '处理中...' : mode === 'login' ? '进入聊天' : '创建账号' }}
        </button>
      </form>

      <div class="auth-note">
        <p>默认管理员：`1 / qwer1234`</p>
        <p>首次注册会在当前浏览器生成并保存本地加密私钥。</p>
      </div>
    </div>
  </div>
</template>
