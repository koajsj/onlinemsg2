<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { apiRequest } from '../lib/api.js';
import {
  clearUnlockedPrivateKey,
  decryptFileUrl,
  decryptPayload,
  ensureConversationKey,
  encryptFile,
  encryptPayload,
  generateAndStoreUserKeys,
  getSecureConversationId,
  hasPrivateKeyPackage,
  isPrivateKeyUnlocked,
  renamePrivateKeyPackage,
  rewrapPrivateKeyPackage,
  unlockPrivateKey
} from '../lib/e2ee.js';
import { CbEvents, MessageType, OnlineState, SessionType, openimConfig, sdk } from '../lib/sdk.js';

const props = defineProps({
  session: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['logout', 'session-updated']);

const loading = ref(true);
const loadingMessages = ref(false);
const sending = ref(false);
const error = ref('');
const connectionStatus = ref('连接中');
const mobileSection = ref('contacts');
const activeUserId = ref('');
const composer = ref('');
const showEmoji = ref(false);
const unlockPassword = ref('');
const setupPassword = ref('');
const adminOpen = ref(false);
const adminLoading = ref(false);
const credentialsLoading = ref(false);

const contacts = ref([]);
const conversations = ref([]);
const messagesByUser = reactive({});
const onlineMap = reactive({});
const attachmentUrls = reactive({});

const profileForm = reactive({
  nickname: props.session.user.nickname || '',
  bio: props.session.user.bio || '',
  avatarUrl: props.session.user.avatarUrl || '',
  theme: props.session.user.preferences?.theme || 'system',
  notifications: Boolean(props.session.user.preferences?.notifications ?? true),
  darkMode: Boolean(props.session.user.preferences?.darkMode ?? false)
});

const credentialsForm = reactive({
  currentPassword: '',
  newUsername: '',
  newPassword: '',
  confirmPassword: ''
});

const adminData = reactive({
  summary: null,
  users: [],
  logins: [],
  security: [],
  system: null
});

const sessionLocked = computed(() => !isPrivateKeyUnlocked(props.session.user.username));
const currentUser = computed(() => props.session.user);
const activeContact = computed(() => contacts.value.find(item => item.userId === activeUserId.value) || null);
const activeMessages = computed(() => {
  const list = messagesByUser[activeUserId.value] || [];
  return [...list].sort((left, right) => left.sendTime - right.sendTime);
});
const unreadMap = computed(() =>
  Object.fromEntries(
    conversations.value
      .filter(item => item.conversationType === SessionType.Single)
      .map(item => [item.userID, Number(item.unreadCount || 0)])
  )
);

const activeConversation = computed(
  () => conversations.value.find(item => item.userID === activeUserId.value && item.conversationType === SessionType.Single) || null
);

const secureParticipants = computed(() => {
  if (!activeContact.value) {
    return [];
  }
  return [
    {
      userId: currentUser.value.userId,
      nickname: currentUser.value.nickname,
      publicKey: currentUser.value.publicKey
    },
    {
      userId: activeContact.value.userId,
      nickname: activeContact.value.nickname,
      publicKey: activeContact.value.publicKey
    }
  ];
});

const eventBindings = [];

const applyTheme = () => {
  const dark = profileForm.theme === 'dark' || (profileForm.theme === 'system' && profileForm.darkMode);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
};

const registerEvent = (event, handler) => {
  sdk.on(event, handler);
  eventBindings.push([event, handler]);
};

const displayName = userId => {
  if (userId === currentUser.value.userId) {
    return currentUser.value.nickname;
  }
  return contacts.value.find(item => item.userId === userId)?.nickname || userId;
};

const formatTime = stamp => {
  if (!stamp) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(stamp));
};

const parseEnvelope = async raw => {
  try {
    if (raw.contentType === MessageType.CustomMessage && raw.customElem?.extension === '257823-e2ee') {
      const envelope = JSON.parse(raw.customElem.data);
      const peerId = raw.sendID === currentUser.value.userId ? raw.recvID : raw.sendID;
      const peer = contacts.value.find(item => item.userId === peerId);
      if (!peer) {
        return null;
      }

      const { key } = await ensureConversationKey({
        session: props.session,
        participants: [
          {
            userId: currentUser.value.userId,
            nickname: currentUser.value.nickname,
            publicKey: currentUser.value.publicKey
          },
          {
            userId: peer.userId,
            nickname: peer.nickname,
            publicKey: peer.publicKey
          }
        ],
        createIfMissing: false
      });

      if (!key) {
        return {
          kind: 'locked',
          body: '未解锁，无法解密当前消息'
        };
      }

      return decryptPayload(key, envelope);
    }

    if (raw.contentType === MessageType.TextMessage && raw.textElem?.content) {
      return {
        kind: 'text',
        body: raw.textElem.content
      };
    }
  } catch (_error) {
    return {
      kind: 'locked',
      body: '消息解密失败'
    };
  }

  return {
    kind: 'text',
    body: '暂不支持的消息类型'
  };
};

const ensureAttachment = async uiMessage => {
  if (!['image', 'file'].includes(uiMessage.kind) || attachmentUrls[uiMessage.id]) {
    return;
  }

  const peer = contacts.value.find(item => item.userId === uiMessage.peerId);
  if (!peer) {
    return;
  }

  const { key } = await ensureConversationKey({
    session: props.session,
    participants: [
      {
        userId: currentUser.value.userId,
        nickname: currentUser.value.nickname,
        publicKey: currentUser.value.publicKey
      },
      {
        userId: peer.userId,
        nickname: peer.nickname,
        publicKey: peer.publicKey
      }
    ],
    createIfMissing: false
  });

  if (!key) {
    return;
  }

  const objectUrl = await decryptFileUrl({
    uploadId: uiMessage.uploadId,
    iv: uiMessage.fileIv,
    key,
    token: props.session.token,
    mimeType: uiMessage.mimeType
  });

  attachmentUrls[uiMessage.id] = objectUrl;
};

const normalizeMessage = async raw => {
  const peerId = raw.sendID === currentUser.value.userId ? raw.recvID : raw.sendID;
  const payload = await parseEnvelope(raw);
  const base = {
    id: raw.clientMsgID,
    peerId,
    conversationId: raw.conversationID,
    fromSelf: raw.sendID === currentUser.value.userId,
    senderName: raw.senderNickname || displayName(raw.sendID),
    sendTime: raw.sendTime || raw.createTime,
    raw
  };

  if (!payload) {
    return null;
  }

  const message = {
    ...base,
    kind: payload.kind,
    body: payload.body || '',
    uploadId: payload.uploadId || '',
    fileName: payload.fileName || '',
    mimeType: payload.mimeType || '',
    size: payload.size || 0,
    fileIv: payload.fileIv || ''
  };

  if (message.kind === 'image') {
    await ensureAttachment(message);
  }

  return message;
};

const mergeMessages = async rawMessages => {
  for (const raw of rawMessages) {
    const ui = await normalizeMessage(raw);
    if (!ui) continue;
    if (!messagesByUser[ui.peerId]) {
      messagesByUser[ui.peerId] = [];
    }

    const existingIndex = messagesByUser[ui.peerId].findIndex(item => item.id === ui.id);
    if (existingIndex >= 0) {
      messagesByUser[ui.peerId][existingIndex] = ui;
    } else {
      messagesByUser[ui.peerId].push(ui);
    }
  }
};

const refreshContacts = async () => {
  const response = await apiRequest('/users', { token: props.session.token });
  contacts.value = response.users.sort((left, right) => left.nickname.localeCompare(right.nickname, 'zh-CN'));
  const ids = contacts.value.map(item => item.userId);
  if (ids.length) {
    const statusResp = await sdk.subscribeUsersStatus(ids);
    for (const entry of statusResp.data || []) {
      onlineMap[entry.userID] = entry.status;
    }
  }
  if (!activeUserId.value && contacts.value.length) {
    activeUserId.value = contacts.value[0].userId;
  }
};

const refreshConversations = async () => {
  const response = await sdk.getConversationListSplit({ offset: 0, count: 200 });
  conversations.value = response.data || [];
};

const loadConversationMessages = async userId => {
  const conversation = conversations.value.find(
    item => item.userID === userId && item.conversationType === SessionType.Single
  );

  if (!conversation) {
    messagesByUser[userId] = messagesByUser[userId] || [];
    return;
  }

  loadingMessages.value = true;
  try {
    const response = await sdk.getAdvancedHistoryMessageList({
      conversationID: conversation.conversationID,
      startClientMsgID: '',
      count: 100
    });
    messagesByUser[userId] = [];
    await mergeMessages(response.data?.messageList || []);
    await sdk.markConversationMessageAsRead(conversation.conversationID);
  } finally {
    loadingMessages.value = false;
  }
};

const selectUser = async userId => {
  activeUserId.value = userId;
  mobileSection.value = 'chat';
  await refreshConversations();
  await loadConversationMessages(userId);
};

const sendEnvelope = async payload => {
  if (!activeContact.value) {
    throw new Error('请先选择联系人');
  }
  if (sessionLocked.value) {
    throw new Error('请先解锁本地加密私钥');
  }

  const { key } = await ensureConversationKey({
    session: props.session,
    participants: secureParticipants.value,
    createIfMissing: true
  });

  const encrypted = await encryptPayload(key, payload);
  const message = await sdk.createCustomMessage({
    data: JSON.stringify(encrypted),
    description: 'secure-envelope',
    extension: '257823-e2ee'
  });

  await sdk.sendMessage({
    recvID: activeContact.value.userId,
    groupID: '',
    message: message.data
  });
};

const sendText = async () => {
  const content = composer.value.trim();
  if (!content) return;

  sending.value = true;
  error.value = '';
  try {
    await sendEnvelope({
      kind: 'text',
      body: content,
      secureConversationId: getSecureConversationId(currentUser.value.userId, activeContact.value.userId)
    });
    composer.value = '';
    showEmoji.value = false;
    await refreshConversations();
    await loadConversationMessages(activeContact.value.userId);
  } catch (sendError) {
    error.value = sendError.message;
  } finally {
    sending.value = false;
  }
};

const sendFile = async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !activeContact.value) return;

  sending.value = true;
  error.value = '';
  try {
    const { key } = await ensureConversationKey({
      session: props.session,
      participants: secureParticipants.value,
      createIfMissing: true
    });

    const encryptedFile = await encryptFile(file, key);
    const formData = new FormData();
    formData.append('category', file.type.startsWith('image/') ? 'image' : 'file');
    formData.append('peerUserId', activeContact.value.userId);
    formData.append('originalName', file.name);
    formData.append('originalMime', file.type || 'application/octet-stream');
    formData.append('file', new File([encryptedFile.bytes], `${file.name}.bin`, { type: 'application/octet-stream' }));
    const uploadResp = await apiRequest('/uploads', {
      method: 'POST',
      token: props.session.token,
      body: formData
    });

    await sendEnvelope({
      kind: file.type.startsWith('image/') ? 'image' : 'file',
      uploadId: uploadResp.upload.id,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      fileIv: encryptedFile.iv,
      secureConversationId: getSecureConversationId(currentUser.value.userId, activeContact.value.userId)
    });

    await refreshConversations();
    await loadConversationMessages(activeContact.value.userId);
  } catch (sendError) {
    error.value = sendError.message;
  } finally {
    sending.value = false;
  }
};

const revoke = async message => {
  if (!message.fromSelf || !message.conversationId) {
    return;
  }

  await sdk.revokeMessage({
    conversationID: message.conversationId,
    clientMsgID: message.id
  });
  await loadConversationMessages(activeUserId.value);
};

const saveProfile = async () => {
  const response = await apiRequest('/users/me', {
    method: 'PATCH',
    token: props.session.token,
    body: {
      nickname: profileForm.nickname,
      bio: profileForm.bio,
      avatarUrl: profileForm.avatarUrl,
      preferences: {
        theme: profileForm.theme,
        notifications: profileForm.notifications,
        darkMode: profileForm.darkMode
      }
    }
  });

  emit('session-updated', {
    ...props.session,
    user: response.user
  });
  Object.assign(profileForm, {
    nickname: response.user.nickname,
    bio: response.user.bio || '',
    avatarUrl: response.user.avatarUrl || '',
    theme: response.user.preferences?.theme || 'system',
    notifications: Boolean(response.user.preferences?.notifications ?? true),
    darkMode: Boolean(response.user.preferences?.darkMode ?? false)
  });
  applyTheme();
};

const updateCredentials = async () => {
  const currentUsername = currentUser.value.username;
  const nextUsername = credentialsForm.newUsername.trim() || currentUsername;
  const nextPassword = credentialsForm.newPassword;

  if (nextPassword && nextPassword !== credentialsForm.confirmPassword) {
    error.value = '两次输入的新密码不一致';
    return;
  }

  credentialsLoading.value = true;
  error.value = '';
  try {
    const payload = await apiRequest('/users/me/credentials', {
      method: 'PATCH',
      token: props.session.token,
      body: {
        currentPassword: credentialsForm.currentPassword,
        newUsername: credentialsForm.newUsername.trim() || undefined,
        newPassword: nextPassword || undefined
      }
    });

    try {
      if (nextUsername !== currentUsername && hasPrivateKeyPackage(currentUsername)) {
        renamePrivateKeyPackage(currentUsername, nextUsername);
      }

      if (nextPassword && hasPrivateKeyPackage(nextUsername)) {
        await rewrapPrivateKeyPackage(nextUsername, credentialsForm.currentPassword, nextPassword);
      }
    } catch (_migrationError) {
      error.value = '账号密码已更新，但当前设备的本地加密私钥没有自动同步，请重新解锁或重新绑定。';
    }

    emit('session-updated', payload);
    Object.assign(credentialsForm, {
      currentPassword: '',
      newUsername: '',
      newPassword: '',
      confirmPassword: ''
    });
  } catch (credentialError) {
    error.value = credentialError.message;
  } finally {
    credentialsLoading.value = false;
  }
};

const unlockEncryption = async () => {
  try {
    await unlockPrivateKey(currentUser.value.username, unlockPassword.value);
    unlockPassword.value = '';
    if (activeUserId.value) {
      await loadConversationMessages(activeUserId.value);
    }
  } catch (_error) {
    error.value = '密码不正确，无法解锁本地私钥';
  }
};

const setupEncryption = async () => {
  try {
    const publicKey = await generateAndStoreUserKeys(currentUser.value.username, setupPassword.value);
    const response = await apiRequest('/users/me', {
      method: 'PATCH',
      token: props.session.token,
      body: {
        publicKey
      }
    });
    emit('session-updated', {
      ...props.session,
      user: response.user
    });
    setupPassword.value = '';
  } catch (setupError) {
    error.value = setupError.message;
  }
};

const openFile = async message => {
  if (!attachmentUrls[message.id]) {
    await ensureAttachment(message);
  }

  if (!attachmentUrls[message.id]) {
    return;
  }

  window.open(attachmentUrls[message.id], '_blank', 'noopener,noreferrer');
};

const loadAdmin = async () => {
  if (!currentUser.value.isAdmin) return;

  adminLoading.value = true;
  try {
    const [summary, users, logins, security, system] = await Promise.all([
      apiRequest('/admin/summary', { token: props.session.token }),
      apiRequest('/admin/users', { token: props.session.token }),
      apiRequest('/admin/logins', { token: props.session.token }),
      apiRequest('/admin/security', { token: props.session.token }),
      apiRequest('/admin/system', { token: props.session.token })
    ]);
    adminData.summary = summary;
    adminData.users = users.users;
    adminData.logins = logins.logs;
    adminData.security = security.events;
    adminData.system = system.system;
  } catch (adminError) {
    error.value = adminError.message;
  } finally {
    adminLoading.value = false;
  }
};

const logout = async () => {
  try {
    await apiRequest('/auth/logout', {
      method: 'POST',
      token: props.session.token
    });
  } catch (_error) {
    // ignore
  }
  clearUnlockedPrivateKey(currentUser.value.username);
  try {
    await sdk.logout();
  } catch (_error) {
    // ignore
  }
  emit('logout');
};

onMounted(async () => {
  applyTheme();
  registerEvent(CbEvents.OnConnectSuccess, () => {
    connectionStatus.value = '已连接';
  });
  registerEvent(CbEvents.OnConnecting, () => {
    connectionStatus.value = '连接中';
  });
  registerEvent(CbEvents.OnConnectFailed, () => {
    connectionStatus.value = '连接失败';
  });
  registerEvent(CbEvents.OnConversationChanged, async () => {
    await refreshConversations();
  });
  registerEvent(CbEvents.OnNewConversation, async () => {
    await refreshConversations();
  });
  registerEvent(CbEvents.OnUserStatusChanged, event => {
    onlineMap[event.data.userID] = event.data.status;
  });
  registerEvent(CbEvents.OnRecvNewMessages, async event => {
    const incoming = event.data || [];
    await mergeMessages(incoming);
    const hasActiveConversationMessage = incoming.some(raw => {
      const peerId = raw.sendID === currentUser.value.userId ? raw.recvID : raw.sendID;
      return peerId === activeUserId.value && activeConversation.value?.conversationID;
    });
    if (hasActiveConversationMessage && activeConversation.value?.conversationID) {
      await sdk.markConversationMessageAsRead(activeConversation.value.conversationID);
    }
    await refreshConversations();
  });
  registerEvent(CbEvents.OnNewRecvMessageRevoked, async () => {
    if (activeUserId.value) {
      await loadConversationMessages(activeUserId.value);
    }
  });

  try {
    await sdk.login({
      userID: props.session.user.userId,
      token: props.session.openimToken,
      platformID: openimConfig.platformID,
      apiAddr: openimConfig.apiAddr,
      wsAddr: openimConfig.wsAddr
    });
    await refreshContacts();
    await refreshConversations();
    if (activeUserId.value) {
      await loadConversationMessages(activeUserId.value);
    }
  } catch (mountError) {
    error.value = mountError.message;
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  for (const [event, handler] of eventBindings) {
    sdk.off(event, handler);
  }
});

watch(
  () => [profileForm.theme, profileForm.darkMode],
  () => applyTheme()
);
</script>

<template>
  <div class="app-shell">
    <div class="app-frame">
      <aside class="left-pane" :class="{ mobileHidden: mobileSection !== 'contacts' }">
        <div class="pane-head">
          <div>
            <p class="pane-label">联系人</p>
            <h2>{{ currentUser.nickname }}</h2>
          </div>
          <span class="status-dot" :class="{ online: connectionStatus === '已连接' }">{{ connectionStatus }}</span>
        </div>

        <div class="contact-list">
          <button
            v-for="contact in contacts"
            :key="contact.userId"
            class="contact-item"
            :class="{ active: contact.userId === activeUserId }"
            type="button"
            @click="selectUser(contact.userId)"
          >
            <div class="avatar-circle">{{ contact.nickname.slice(0, 1) }}</div>
            <div class="contact-meta">
              <strong>{{ contact.nickname }}</strong>
              <div class="contact-subline">
                <span>{{ onlineMap[contact.userId] === OnlineState.Online ? '在线' : '离线' }}</span>
                <span v-if="unreadMap[contact.userId]" class="unread-badge">{{ unreadMap[contact.userId] }}</span>
              </div>
            </div>
          </button>
        </div>
      </aside>

      <main class="chat-pane" :class="{ mobileHidden: mobileSection !== 'chat' }">
        <div class="pane-head">
          <button class="mobile-back" type="button" @click="mobileSection = 'contacts'">返回</button>
          <div>
            <p class="pane-label">会话</p>
            <h2>{{ activeContact?.nickname || '选择联系人' }}</h2>
          </div>
          <div class="pane-actions">
            <label class="upload-button">
              发送文件
              <input accept="image/*,.pdf,.txt,.zip,.docx,.xlsx" type="file" @change="sendFile">
            </label>
          </div>
        </div>

        <div v-if="loading" class="empty-state">正在连接 OpenIM...</div>
        <div v-else-if="!activeContact" class="empty-state">先从左侧选择一个联系人。</div>
        <div v-else class="message-area">
          <div class="message-list">
            <div v-if="loadingMessages" class="empty-state subtle">正在读取消息...</div>
            <div v-for="message in activeMessages" :key="message.id" class="message-row" :class="{ self: message.fromSelf }">
              <div class="message-bubble" :class="message.kind">
                <template v-if="message.kind === 'image'">
                  <img v-if="attachmentUrls[message.id]" :src="attachmentUrls[message.id]" alt="图片消息" class="message-image">
                  <button v-else class="inline-link" type="button" @click="ensureAttachment(message)">加载图片</button>
                </template>
                <template v-else-if="message.kind === 'file'">
                  <button class="file-chip" type="button" @click="openFile(message)">
                    <strong>{{ message.fileName }}</strong>
                    <span>{{ Math.ceil(message.size / 1024) }} KB</span>
                  </button>
                </template>
                <template v-else>
                  {{ message.body }}
                </template>

                <div class="message-foot">
                  <span>{{ formatTime(message.sendTime) }}</span>
                  <button v-if="message.fromSelf" class="ghost-link" type="button" @click="revoke(message)">撤回</button>
                </div>
              </div>
            </div>
          </div>

          <div v-if="error" class="form-error in-chat">{{ error }}</div>

          <div class="composer">
            <div class="emoji-row" v-if="showEmoji">
              <button type="button" @click="composer += '🙂'">🙂</button>
              <button type="button" @click="composer += '👍'">👍</button>
              <button type="button" @click="composer += '🎉'">🎉</button>
              <button type="button" @click="composer += '❤️'">❤️</button>
            </div>
            <div class="composer-bar">
              <button class="ghost-icon" type="button" @click="showEmoji = !showEmoji">😊</button>
              <textarea v-model="composer" placeholder="输入加密消息..." rows="1" @keydown.enter.prevent="sendText" />
              <button class="primary-button small" :disabled="sending" type="button" @click="sendText">发送</button>
            </div>
          </div>
        </div>
      </main>

      <aside class="right-pane" :class="{ mobileHidden: mobileSection !== 'settings' }">
        <div class="pane-head">
          <button class="mobile-back" type="button" @click="mobileSection = 'chat'">返回</button>
          <div>
            <p class="pane-label">资料与设置</p>
            <h2>账号</h2>
          </div>
        </div>

        <div class="settings-card">
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
          <button class="primary-button" type="button" @click="saveProfile">保存设置</button>
        </div>

        <div class="settings-card">
          <h3>{{ currentUser.isAdmin ? '管理员登录信息' : '登录信息' }}</h3>
          <label>
            <span>当前账号</span>
            <input :value="currentUser.username" disabled>
          </label>
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
          <button class="primary-button" :disabled="credentialsLoading" type="button" @click="updateCredentials">
            {{ credentialsLoading ? '保存中...' : '更新账号密码' }}
          </button>
        </div>

        <div v-if="sessionLocked" class="settings-card warning-card">
          <template v-if="hasPrivateKeyPackage(currentUser.username)">
            <h3>解锁加密私钥</h3>
            <input v-model="unlockPassword" placeholder="重新输入登录密码" type="password">
            <button class="primary-button" type="button" @click="unlockEncryption">解锁消息</button>
          </template>
          <template v-else>
            <h3>初始化本机密钥</h3>
            <p>当前设备没有私钥，旧消息无法自动恢复。生成新密钥后，新消息会继续加密。</p>
            <input v-model="setupPassword" placeholder="设置当前设备密钥密码" type="password">
            <button class="primary-button" type="button" @click="setupEncryption">生成并绑定</button>
          </template>
        </div>

        <div class="settings-card compact">
          <button v-if="currentUser.isAdmin" class="ghost-button" type="button" @click="adminOpen = true; loadAdmin()">管理员后台</button>
          <button class="ghost-button danger" type="button" @click="logout">退出登录</button>
        </div>
      </aside>
    </div>

    <div class="mobile-tabs">
      <button :class="{ active: mobileSection === 'contacts' }" type="button" @click="mobileSection = 'contacts'">联系人</button>
      <button :class="{ active: mobileSection === 'chat' }" type="button" @click="mobileSection = 'chat'">聊天</button>
      <button :class="{ active: mobileSection === 'settings' }" type="button" @click="mobileSection = 'settings'">设置</button>
    </div>

    <div v-if="adminOpen" class="admin-overlay">
      <div class="admin-panel">
        <div class="pane-head">
          <div>
            <p class="pane-label">后台</p>
            <h2>管理员控制台</h2>
          </div>
          <button class="ghost-button" type="button" @click="adminOpen = false">关闭</button>
        </div>

        <div v-if="adminLoading" class="empty-state">后台数据加载中...</div>
        <template v-else>
          <div class="admin-grid">
            <div class="metric-card">
              <span>用户总数</span>
              <strong>{{ adminData.summary?.stats.totalUsers || 0 }}</strong>
            </div>
            <div class="metric-card">
              <span>近期成功登录</span>
              <strong>{{ adminData.summary?.stats.recentLoginCount || 0 }}</strong>
            </div>
            <div class="metric-card">
              <span>安全事件</span>
              <strong>{{ adminData.summary?.stats.securityEventCount || 0 }}</strong>
            </div>
            <div class="metric-card">
              <span>服务状态</span>
              <strong>{{ adminData.summary?.openim?.ok ? '正常' : '异常' }}</strong>
            </div>
          </div>

          <div class="admin-section">
            <h3>用户列表</h3>
            <div class="admin-table">
              <div v-for="item in adminData.users" :key="item.userId" class="table-row">
                <span>{{ item.username }}</span>
                <span>{{ item.nickname }}</span>
                <span>{{ item.onlineStatus === OnlineState.Online ? '在线' : '离线' }}</span>
                <span>{{ item.role === 'admin' ? '管理员' : '用户' }}</span>
              </div>
            </div>
          </div>

          <div class="admin-section">
            <h3>登录日志</h3>
            <div class="admin-table">
              <div v-for="item in adminData.logins" :key="item.id" class="table-row">
                <span>{{ item.username }}</span>
                <span>{{ item.status }}</span>
                <span>{{ item.ipAddress }}</span>
                <span>{{ item.browser }}</span>
              </div>
            </div>
          </div>

          <div class="admin-section">
            <h3>异常登录提示</h3>
            <div class="admin-table">
              <div v-for="item in adminData.security" :key="item.id" class="table-row">
                <span>{{ item.eventType }}</span>
                <span>{{ item.ipAddress }}</span>
                <span>{{ item.browser }}</span>
                <span>{{ item.details }}</span>
              </div>
            </div>
          </div>

          <div class="admin-section">
            <h3>基础运维信息</h3>
            <div class="system-list">
              <p>系统版本：{{ adminData.system?.platform }}</p>
              <p>Node：{{ adminData.system?.nodeVersion }}</p>
              <p>主机：{{ adminData.system?.hostname }}</p>
              <p>内存：{{ adminData.system?.freeMemoryMb }} / {{ adminData.system?.totalMemoryMb }} MB</p>
              <p>CPU：{{ adminData.system?.cpuModel }}</p>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
