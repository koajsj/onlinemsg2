<script setup>
defineProps({
  currentUser: {
    type: Object,
    required: true
  },
  connectionStatus: {
    type: String,
    required: true
  },
  contactCards: {
    type: Array,
    required: true
  },
  activeUserId: {
    type: String,
    required: true
  }
});

defineEmits(['select-contact']);
</script>

<template>
  <div class="pane-shell">
    <div class="pane-head pane-head--split">
      <div>
        <p class="pane-label">联系人</p>
        <h2>{{ currentUser.nickname }}</h2>
        <p class="pane-copy">只在当前设备解密消息正文与附件内容。</p>
      </div>
      <span class="status-chip" :class="{ online: connectionStatus === '已连接' }">{{ connectionStatus }}</span>
    </div>

    <div class="sidebar-meta">
      <span class="tiny-chip">全部联系人 {{ contactCards.length }}</span>
      <span class="sidebar-note">按最近会话优先排序</span>
    </div>

    <div v-if="!contactCards.length" class="empty-card">
      <strong>还没有联系人</strong>
      <p>先注册另一个账号，登录后这里会自动出现联系人。</p>
    </div>

    <div v-else class="contact-list">
      <button
        v-for="contact in contactCards"
        :key="contact.userId"
        class="contact-item"
        :class="{ active: contact.userId === activeUserId }"
        type="button"
        @click="$emit('select-contact', contact.userId)"
      >
        <div class="avatar-circle">{{ contact.nickname.slice(0, 1) }}</div>
        <div class="contact-main">
          <div class="contact-title-row">
            <strong>{{ contact.nickname }}</strong>
            <span class="contact-time">{{ contact.timeLabel }}</span>
          </div>
          <div class="contact-subline">
            <span class="presence-badge" :class="{ online: contact.isOnline }">{{ contact.onlineLabel }}</span>
            <span class="contact-preview">{{ contact.preview }}</span>
          </div>
        </div>
        <span v-if="contact.unreadCount" class="unread-badge">{{ contact.unreadCount }}</span>
      </button>
    </div>
  </div>
</template>
