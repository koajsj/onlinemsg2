<script setup>
import { computed, reactive, ref } from 'vue';
import { apiRequest } from '../lib/api.js';
import {
  createUserKeyBundle,
  hasPrivateKeyPackage,
  persistUserKeyBundle,
  unlockPrivateKey
} from '../lib/e2ee.js';

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

const title = computed(() => (mode.value === 'login' ? '欢迎回来' : '创建新账号'));
const submitLabel = computed(() => {
  if (loading.value) {
    return mode.value === 'login' ? '正在登录…' : '正在创建…';
  }
  return mode.value === 'login' ? '进入聊天' : '创建账号';
});

const submit = async () => {
  loading.value = true;
  error.value = '';
  hint.value = '';

  try {
    if (mode.value === 'register') {
      const bundle = await createUserKeyBundle();
      const payload = await apiRequest('/auth/register', {
        method: 'POST',
        body: {
          username: form.username,
          password: form.password,
          nickname: form.nickname || form.username,
          publicKey: bundle.publicKey
        }
      });
      try {
        await persistUserKeyBundle({
          username: form.username,
          password: form.password,
          privateJwk: bundle.privateJwk,
          privateKey: bundle.privateKey
        });
      } catch (_persistError) {
        hint.value = '账号已创建，但当前浏览器没有成功保存本地私钥。登录后请在设置页重新生成本机密钥。';
      }
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
      } catch (_unlockError) {
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
    <section class="auth-hero">
      <div class="auth-hero__content">
        <p class="auth-eyebrow">257823.xyz</p>
        <h1>私有聊天，保持干净、克制、加密。</h1>
        <p class="auth-lead">OpenIM 负责即时通信，浏览器负责消息正文、图片和文件的客户端解密。</p>

        <div class="auth-feature-grid">
          <div class="auth-feature-card">
            <strong>默认端到端加密</strong>
            <span>文本、图片、文件都按当前设备的密钥体系处理。</span>
          </div>
          <div class="auth-feature-card">
            <strong>部署轻量</strong>
            <span>前端 `8080`，OpenIM API `10002`，不占用 `443`。</span>
          </div>
          <div class="auth-feature-card">
            <strong>管理员可审计</strong>
            <span>登录日志、安全事件、系统状态集中查看。</span>
          </div>
        </div>
      </div>
    </section>

    <section class="auth-panel">
      <div class="auth-card">
        <div class="auth-card__head">
          <div>
            <p class="pane-label">身份验证</p>
            <h2>{{ title }}</h2>
            <p class="pane-copy">{{ mode === 'login' ? '输入账号密码后进入会话。' : '注册时会在当前浏览器生成并保存本地私钥。' }}</p>
          </div>
        </div>

        <div class="auth-switch">
          <button :class="{ active: mode === 'login' }" type="button" @click="mode = 'login'">登录</button>
          <button :class="{ active: mode === 'register' }" type="button" @click="mode = 'register'">注册</button>
        </div>

        <form class="auth-form" @submit.prevent="submit">
          <label>
            <span>账号</span>
            <input
              v-model.trim="form.username"
              autocomplete="username"
              maxlength="24"
              placeholder="仅限字母、数字、下划线"
              required
            >
          </label>

          <label v-if="mode === 'register'">
            <span>昵称</span>
            <input v-model.trim="form.nickname" maxlength="32" placeholder="聊天中显示的名称">
          </label>

          <label>
            <span>密码</span>
            <input
              v-model="form.password"
              autocomplete="current-password"
              minlength="8"
              type="password"
              placeholder="至少 8 位，需包含字母和数字"
              required
            >
          </label>

          <p v-if="error" class="inline-banner is-error">{{ error }}</p>
          <p v-if="hint" class="inline-banner is-success">{{ hint }}</p>

          <button class="primary-button auth-submit" :disabled="loading" type="submit">
            {{ submitLabel }}
          </button>
        </form>

        <div class="auth-note">
          <p>默认管理员：<code>1 / qwer1234</code></p>
          <p>管理员账号和密码都可以在登录后的设置区内修改。</p>
        </div>
      </div>
    </section>
  </div>
</template>
