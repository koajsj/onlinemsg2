<script setup>
defineProps({
  currentUser: {
    type: Object,
    required: true
  },
  profileForm: {
    type: Object,
    required: true
  },
  credentialsForm: {
    type: Object,
    required: true
  },
  feedback: {
    type: Object,
    required: true
  },
  sessionLocked: {
    type: Boolean,
    required: true
  },
  hasLocalPrivateKey: {
    type: Boolean,
    required: true
  },
  unlockPassword: {
    type: String,
    required: true
  },
  setupPassword: {
    type: String,
    required: true
  },
  credentialsLoading: {
    type: Boolean,
    required: true
  }
});

defineEmits([
  'back',
  'save-profile',
  'update-credentials',
  'update:unlockPassword',
  'update:setupPassword',
  'unlock-encryption',
  'setup-encryption',
  'open-admin',
  'logout'
]);
</script>

<template>
  <div class="pane-shell pane-shell--settings">
    <div class="pane-head pane-head--settings">
      <button class="mobile-back" type="button" @click="$emit('back')">返回</button>
      <div>
        <p class="pane-label">资料与设置</p>
        <h2>账号中心</h2>
        <p class="pane-copy">在这里维护资料、登录信息和当前设备的加密状态。</p>
      </div>
    </div>

    <div v-if="feedback.text" class="inline-banner" :class="`is-${feedback.tone}`">
      {{ feedback.text }}
    </div>

    <div class="settings-scroll">
      <section class="surface-card">
        <div class="section-head">
          <div>
            <p class="section-label">资料</p>
            <h3>个人信息</h3>
          </div>
          <span class="tiny-chip">{{ currentUser.nickname }}</span>
        </div>
        <label>
          <span>昵称</span>
          <input v-model.trim="profileForm.nickname" maxlength="32">
        </label>
        <label>
          <span>头像 URL</span>
          <input v-model.trim="profileForm.avatarUrl" maxlength="500">
        </label>
        <label>
          <span>个人说明</span>
          <textarea v-model.trim="profileForm.bio" maxlength="160" rows="3" />
        </label>
        <label>
          <span>界面主题</span>
          <select v-model="profileForm.theme">
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>
        <label class="switch-row">
          <span>通知开关</span>
          <input v-model="profileForm.notifications" type="checkbox">
        </label>
        <label class="switch-row">
          <span>深色偏好</span>
          <input v-model="profileForm.darkMode" type="checkbox">
        </label>
        <button class="primary-button" type="button" @click="$emit('save-profile')">保存资料</button>
      </section>

      <section class="surface-card">
        <div class="section-head">
          <div>
            <p class="section-label">登录</p>
            <h3>{{ currentUser.isAdmin ? '管理员登录信息' : '登录信息' }}</h3>
          </div>
          <span class="tiny-chip">账号：{{ currentUser.username }}</span>
        </div>
        <label>
          <span>当前密码</span>
          <input v-model="credentialsForm.currentPassword" autocomplete="current-password" type="password">
        </label>
        <label>
          <span>新账号</span>
          <input v-model.trim="credentialsForm.newUsername" maxlength="24" placeholder="留空表示不修改账号">
        </label>
        <label>
          <span>新密码</span>
          <input v-model="credentialsForm.newPassword" autocomplete="new-password" type="password" placeholder="留空表示不修改密码">
        </label>
        <label>
          <span>确认新密码</span>
          <input v-model="credentialsForm.confirmPassword" autocomplete="new-password" type="password">
        </label>
        <button class="primary-button" :disabled="credentialsLoading" type="button" @click="$emit('update-credentials')">
          {{ credentialsLoading ? '保存中…' : '更新账号密码' }}
        </button>
      </section>

      <section class="surface-card" :class="{ 'surface-card--warning': sessionLocked }">
        <div class="section-head">
          <div>
            <p class="section-label">加密</p>
            <h3>当前设备密钥</h3>
          </div>
          <span class="tiny-chip" :class="{ 'tiny-chip--warning': sessionLocked, 'tiny-chip--success': !sessionLocked }">
            {{ sessionLocked ? '未就绪' : '已解锁' }}
          </span>
        </div>

        <template v-if="sessionLocked && hasLocalPrivateKey">
          <p class="section-copy">当前浏览器已有私钥包，但还没有解锁。输入当前密码后，历史加密消息和附件才能读取。</p>
          <input
            :value="unlockPassword"
            placeholder="重新输入登录密码"
            type="password"
            @input="$emit('update:unlockPassword', $event.target.value)"
          >
          <button class="primary-button" type="button" @click="$emit('unlock-encryption')">解锁消息</button>
        </template>

        <template v-else-if="sessionLocked">
          <p class="section-copy">当前设备没有本地私钥。生成并绑定后，新消息会继续加密，但旧消息无法自动恢复。</p>
          <input
            :value="setupPassword"
            placeholder="设置当前设备密钥密码"
            type="password"
            @input="$emit('update:setupPassword', $event.target.value)"
          >
          <button class="primary-button" type="button" @click="$emit('setup-encryption')">生成并绑定</button>
        </template>

        <template v-else>
          <p class="section-copy">当前设备已具备完整的加密能力，可以正常发送、接收、解密文本、图片和文件。</p>
        </template>
      </section>

      <section class="surface-card surface-card--danger">
        <div class="section-head">
          <div>
            <p class="section-label">操作</p>
            <h3>后台与退出</h3>
          </div>
        </div>
        <div class="stack-actions">
          <button v-if="currentUser.isAdmin" class="secondary-button" type="button" @click="$emit('open-admin')">进入管理员后台</button>
          <button class="ghost-button danger" type="button" @click="$emit('logout')">退出登录</button>
        </div>
      </section>
    </div>
  </div>
</template>
