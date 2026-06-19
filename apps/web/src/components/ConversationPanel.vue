<script setup>
import { nextTick, onMounted, ref, watch } from 'vue';
import { formatClockTime, formatFileSize } from '../lib/ui.js';

const props = defineProps({
  loading: {
    type: Boolean,
    required: true
  },
  loadingMessages: {
    type: Boolean,
    required: true
  },
  sending: {
    type: Boolean,
    required: true
  },
  activeContact: {
    type: Object,
    default: null
  },
  displayedMessages: {
    type: Array,
    required: true
  },
  attachmentUrls: {
    type: Object,
    required: true
  },
  composer: {
    type: String,
    required: true
  },
  showEmoji: {
    type: Boolean,
    required: true
  },
  feedback: {
    type: Object,
    required: true
  },
  encryptionNotice: {
    type: String,
    default: ''
  }
});

const emit = defineEmits([
  'back',
  'send-file',
  'update:composer',
  'toggle-emoji',
  'send-text',
  'load-attachment',
  'open-file',
  'revoke'
]);

const textareaRef = ref(null);

const resizeComposer = async () => {
  await nextTick();
  if (!textareaRef.value) {
    return;
  }
  textareaRef.value.style.height = '52px';
  textareaRef.value.style.height = `${Math.min(textareaRef.value.scrollHeight, 160)}px`;
};

const handleKeydown = event => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
    return;
  }

  event.preventDefault();
  emit('send-text');
};

watch(
  () => props.composer,
  () => {
    resizeComposer();
  }
);

onMounted(() => {
  resizeComposer();
});
</script>

<template>
  <div class="pane-shell pane-shell--conversation">
    <div class="pane-head pane-head--conversation">
      <button class="mobile-back" type="button" @click="$emit('back')">返回</button>
      <div class="conversation-heading">
        <p class="pane-label">当前会话</p>
        <h2>{{ activeContact?.nickname || '选择联系人' }}</h2>
        <p class="pane-copy">{{ activeContact ? '当前消息正文和附件只在双方设备解密。' : '从左侧选择一个联系人开始聊天。' }}</p>
      </div>
      <label class="action-button upload-button" :class="{ disabled: !activeContact || sending }">
        <span>{{ sending ? '发送中…' : '发送文件' }}</span>
        <input
          accept="image/*,.pdf,.txt,.zip,.docx,.xlsx"
          type="file"
          :disabled="!activeContact || sending"
          @change="$emit('send-file', $event)"
        >
      </label>
    </div>

    <div v-if="feedback.text" class="inline-banner" :class="`is-${feedback.tone}`">
      {{ feedback.text }}
    </div>

    <div v-if="encryptionNotice" class="inline-banner is-warning">
      {{ encryptionNotice }}
    </div>

    <div v-if="loading" class="empty-state">
      <strong>正在连接 OpenIM</strong>
      <p>连接建立后会自动同步联系人和消息。</p>
    </div>
    <div v-else-if="!activeContact" class="empty-state">
      <strong>先选择一个联系人</strong>
      <p>左侧会按最近会话优先展示联系人，你也可以在手机端用底部切换。</p>
    </div>
    <div v-else class="message-area">
      <div class="message-list">
        <div v-if="loadingMessages" class="empty-state subtle">正在读取消息…</div>
        <div
          v-for="message in displayedMessages"
          :key="message.id"
          class="message-row"
          :class="{ self: message.fromSelf }"
        >
          <div class="message-bubble" :class="[`message-${message.kind}`, { locked: message.kind === 'locked' }]">
            <template v-if="message.kind === 'image'">
              <img
                v-if="attachmentUrls[message.id]"
                :src="attachmentUrls[message.id]"
                alt="图片消息"
                class="message-image"
              >
              <template v-else>
                <button class="inline-link" type="button" @click="$emit('load-attachment', message)">加载图片</button>
                <span v-if="message.attachmentError" class="attachment-error">{{ message.attachmentError }}</span>
              </template>
            </template>
            <template v-else-if="message.kind === 'file'">
              <button class="file-chip" type="button" @click="$emit('open-file', message)">
                <strong>{{ message.fileName || '未命名附件' }}</strong>
                <span>{{ formatFileSize(message.size) }}</span>
              </button>
              <span v-if="message.attachmentError" class="attachment-error">{{ message.attachmentError }}</span>
            </template>
            <template v-else>
              <p class="message-body">{{ message.body }}</p>
            </template>

            <div class="message-foot">
              <span>{{ formatClockTime(message.sendTime) }}</span>
              <button
                v-if="message.fromSelf"
                class="ghost-link"
                type="button"
                @click="$emit('revoke', message)"
              >
                撤回
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="composer">
        <div v-if="showEmoji" class="emoji-row">
          <button type="button" @click="$emit('update:composer', composer + '🙂')">🙂</button>
          <button type="button" @click="$emit('update:composer', composer + '👍')">👍</button>
          <button type="button" @click="$emit('update:composer', composer + '🎉')">🎉</button>
          <button type="button" @click="$emit('update:composer', composer + '❤️')">❤️</button>
        </div>
        <div class="composer-bar">
          <button class="icon-button" type="button" @click="$emit('toggle-emoji')">表情</button>
          <textarea
            ref="textareaRef"
            :value="composer"
            rows="1"
            placeholder="输入加密消息，Enter 发送，Shift+Enter 换行"
            @input="$emit('update:composer', $event.target.value)"
            @keydown="handleKeydown"
          />
          <button class="primary-button primary-button--compact" :disabled="sending" type="button" @click="$emit('send-text')">
            {{ sending ? '发送中…' : '发送' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
