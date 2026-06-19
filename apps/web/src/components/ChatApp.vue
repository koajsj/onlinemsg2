<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import AdminWorkspace from './AdminWorkspace.vue';
import ContactSidebar from './ContactSidebar.vue';
import ConversationPanel from './ConversationPanel.vue';
import ProfileSettingsPanel from './ProfileSettingsPanel.vue';
import { apiRequest } from '../lib/api.js';
import {
  clearConversationKeyCache,
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
import { formatConversationTime, getMessagePreview, getOnlineLabel } from '../lib/ui.js';

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

const chatFeedback = reactive({ tone: '', text: '' });
const settingsFeedback = reactive({ tone: '', text: '' });
const adminFeedback = reactive({ tone: '', text: '' });

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

const eventBindings = [];

const currentUser = computed(() => props.session.user);
const hasLocalPrivateKey = computed(() => hasPrivateKeyPackage(currentUser.value.username));
const sessionLocked = computed(() => !isPrivateKeyUnlocked(currentUser.value.username));
const activeContact = computed(() => contacts.value.find(item => item.userId === activeUserId.value) || null);
const activeConversation = computed(
  () => conversations.value.find(item => item.userID === activeUserId.value && item.conversationType === SessionType.Single) || null
);
const activeMessages = computed(() => {
  const list = messagesByUser[activeUserId.value] || [];
  return [...list].sort((left, right) => left.sendTime - right.sendTime);
});
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
const encryptionNotice = computed(() => {
  if (!activeContact.value) {
    return '';
  }

  if (sessionLocked.value && hasLocalPrivateKey.value) {
    return '当前设备私钥未解锁，只能看到会话元数据，无法读取加密正文和附件。';
  }

  if (sessionLocked.value) {
    return '当前设备没有本地私钥。生成并绑定后，新消息可以继续加密，但旧消息无法自动恢复。';
  }

  return '当前会话正文、图片和文件都由浏览器端解密。';
});

const conversationMap = computed(() => {
  const map = new Map();
  for (const item of conversations.value) {
    if (item.conversationType === SessionType.Single) {
      map.set(item.userID, item);
    }
  }
  return map;
});

const contactCards = computed(() =>
  contacts.value
    .map(contact => {
      const conversation = conversationMap.value.get(contact.userId);
      const list = messagesByUser[contact.userId] || [];
      const lastMessage = list.length ? list[list.length - 1] : null;
      const sortTime = Number(lastMessage?.sendTime || conversation?.latestMsgSendTime || conversation?.latestMsgRecvTime || 0);
      const unreadCount = Number(conversation?.unreadCount || 0);

      return {
        ...contact,
        isOnline: onlineMap[contact.userId] === OnlineState.Online,
        onlineLabel: getOnlineLabel(onlineMap[contact.userId], OnlineState.Online),
        unreadCount,
        preview: lastMessage
          ? getMessagePreview(lastMessage)
          : unreadCount
            ? `${unreadCount} 条未读消息`
            : conversation
              ? '打开继续聊天'
              : '开始新的加密聊天',
        timeLabel: formatConversationTime(sortTime),
        sortTime
      };
    })
    .sort((left, right) => {
      if (left.sortTime !== right.sortTime) {
        return right.sortTime - left.sortTime;
      }
      if (left.isOnline !== right.isOnline) {
        return left.isOnline ? -1 : 1;
      }
      return left.nickname.localeCompare(right.nickname, 'zh-CN');
    })
);

const isStrongLocalPassword = password =>
  typeof password === 'string' &&
  password.length >= 8 &&
  /[A-Za-z]/.test(password) &&
  /\d/.test(password);

const mimeByExtension = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};
const allowedUploadMimeTypes = new Set(Object.values(mimeByExtension));

const toErrorMessage = (input, fallback) => input?.message || fallback;
const setChatFeedback = (tone, text) => {
  chatFeedback.tone = tone;
  chatFeedback.text = text;
};
const setSettingsFeedback = (tone, text) => {
  settingsFeedback.tone = tone;
  settingsFeedback.text = text;
};
const setAdminFeedback = (tone, text) => {
  adminFeedback.tone = tone;
  adminFeedback.text = text;
};
const clearChatFeedback = () => setChatFeedback('', '');
const clearSettingsFeedback = () => setSettingsFeedback('', '');
const clearAdminFeedback = () => setAdminFeedback('', '');

const revokeAttachmentUrl = messageId => {
  if (!attachmentUrls[messageId]) {
    return;
  }

  URL.revokeObjectURL(attachmentUrls[messageId]);
  delete attachmentUrls[messageId];
};

const clearMessageAttachments = userId => {
  const list = messagesByUser[userId] || [];
  for (const item of list) {
    revokeAttachmentUrl(item.id);
  }
};

const resolveUploadMime = file => {
  if (file.type) {
    return file.type;
  }

  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  return mimeByExtension[extension] || 'application/octet-stream';
};

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
          body: '当前设备未解锁，暂时无法解密这条消息。'
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
      body: '消息解密失败，请重新解锁当前设备密钥后再试。'
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
    throw new Error('未找到该联系人的加密信息');
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
    throw new Error('当前设备还没有解锁会话密钥，无法读取附件');
  }

  try {
    const objectUrl = await decryptFileUrl({
      uploadId: uiMessage.uploadId,
      iv: uiMessage.fileIv,
      key,
      token: props.session.token,
      mimeType: uiMessage.mimeType
    });
    revokeAttachmentUrl(uiMessage.id);
    attachmentUrls[uiMessage.id] = objectUrl;
  } catch (_error) {
    throw new Error('附件解密失败，请确认当前设备私钥已解锁');
  }
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
    fileIv: payload.fileIv || '',
    attachmentError: ''
  };

  if (message.kind === 'image') {
    try {
      await ensureAttachment(message);
    } catch (attachmentError) {
      message.attachmentError = toErrorMessage(attachmentError, '图片解密失败');
    }
  }

  return message;
};

const mergeMessages = async rawMessages => {
  for (const raw of rawMessages) {
    const ui = await normalizeMessage(raw);
    if (!ui) {
      continue;
    }

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
    clearMessageAttachments(userId);
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
    clearMessageAttachments(userId);
    messagesByUser[userId] = [];
    await mergeMessages(response.data?.messageList || []);
    await sdk.markConversationMessageAsRead(conversation.conversationID);
  } finally {
    loadingMessages.value = false;
  }
};

const selectUser = async userId => {
  clearChatFeedback();
  try {
    activeUserId.value = userId;
    mobileSection.value = 'chat';
    await refreshConversations();
    await loadConversationMessages(userId);
  } catch (selectError) {
    setChatFeedback('error', toErrorMessage(selectError, '会话切换失败'));
  }
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
  if (!content) {
    return;
  }

  sending.value = true;
  clearChatFeedback();
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
    setChatFeedback('error', toErrorMessage(sendError, '消息发送失败'));
  } finally {
    sending.value = false;
  }
};

const sendFile = async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !activeContact.value) {
    return;
  }

  sending.value = true;
  clearChatFeedback();
  try {
    const originalMime = resolveUploadMime(file);
    if (!allowedUploadMimeTypes.has(originalMime)) {
      throw new Error('当前只支持图片、PDF、TXT、ZIP、DOCX、XLSX 文件');
    }

    const { key } = await ensureConversationKey({
      session: props.session,
      participants: secureParticipants.value,
      createIfMissing: true
    });

    const encryptedFile = await encryptFile(file, key);
    const formData = new FormData();
    formData.append('category', originalMime.startsWith('image/') ? 'image' : 'file');
    formData.append('peerUserId', activeContact.value.userId);
    formData.append('originalName', file.name);
    formData.append('originalMime', originalMime);
    formData.append(
      'file',
      new File([encryptedFile.bytes], `${file.name}.bin`, { type: 'application/octet-stream' })
    );

    const uploadResp = await apiRequest('/uploads', {
      method: 'POST',
      token: props.session.token,
      body: formData
    });

    await sendEnvelope({
      kind: originalMime.startsWith('image/') ? 'image' : 'file',
      uploadId: uploadResp.upload.id,
      fileName: file.name,
      mimeType: originalMime,
      size: file.size,
      fileIv: encryptedFile.iv,
      secureConversationId: getSecureConversationId(currentUser.value.userId, activeContact.value.userId)
    });

    await refreshConversations();
    await loadConversationMessages(activeContact.value.userId);
  } catch (sendError) {
    setChatFeedback('error', toErrorMessage(sendError, '附件发送失败'));
  } finally {
    sending.value = false;
  }
};

const revoke = async message => {
  if (!message.fromSelf || !message.conversationId) {
    return;
  }

  clearChatFeedback();
  try {
    await sdk.revokeMessage({
      conversationID: message.conversationId,
      clientMsgID: message.id
    });
    await loadConversationMessages(activeUserId.value);
    setChatFeedback('success', '消息已撤回');
  } catch (revokeError) {
    setChatFeedback('error', toErrorMessage(revokeError, '消息撤回失败'));
  }
};

const saveProfile = async () => {
  clearSettingsFeedback();
  try {
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
    setSettingsFeedback('success', '资料已保存');
  } catch (saveError) {
    setSettingsFeedback('error', toErrorMessage(saveError, '资料保存失败'));
  }
};

const updateCredentials = async () => {
  const currentUsername = currentUser.value.username;
  const nextUsername = credentialsForm.newUsername.trim() || currentUsername;
  const nextPassword = credentialsForm.newPassword;

  if (nextPassword && nextPassword !== credentialsForm.confirmPassword) {
    setSettingsFeedback('error', '两次输入的新密码不一致');
    return;
  }

  credentialsLoading.value = true;
  clearSettingsFeedback();
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
      setSettingsFeedback('warning', '账号密码已更新，但当前设备的本地私钥没有自动同步，请重新解锁或重新绑定。');
    }

    emit('session-updated', payload);
    Object.assign(credentialsForm, {
      currentPassword: '',
      newUsername: '',
      newPassword: '',
      confirmPassword: ''
    });

    if (!settingsFeedback.text) {
      setSettingsFeedback('success', '账号信息已更新');
    }
  } catch (credentialError) {
    setSettingsFeedback('error', toErrorMessage(credentialError, '账号信息更新失败'));
  } finally {
    credentialsLoading.value = false;
  }
};

const unlockEncryption = async () => {
  if (!unlockPassword.value.trim()) {
    setSettingsFeedback('error', '请输入当前密码后再解锁');
    return;
  }

  clearSettingsFeedback();
  try {
    await unlockPrivateKey(currentUser.value.username, unlockPassword.value);
    unlockPassword.value = '';
    if (activeUserId.value) {
      await loadConversationMessages(activeUserId.value);
    }
    setSettingsFeedback('success', '当前设备私钥已解锁');
  } catch (_error) {
    setSettingsFeedback('error', '密码不正确，无法解锁本地私钥');
  }
};

const setupEncryption = async () => {
  if (!isStrongLocalPassword(setupPassword.value)) {
    setSettingsFeedback('error', '本机密钥密码至少 8 位，且必须包含字母和数字');
    return;
  }

  clearSettingsFeedback();
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
    setSettingsFeedback('success', '本机密钥已生成并绑定');
  } catch (setupError) {
    setSettingsFeedback('error', toErrorMessage(setupError, '本机密钥初始化失败'));
  }
};

const openFile = async message => {
  clearChatFeedback();
  try {
    if (!attachmentUrls[message.id]) {
      await ensureAttachment(message);
      message.attachmentError = '';
    }

    if (!attachmentUrls[message.id]) {
      throw new Error('附件还没有成功加载');
    }

    window.open(attachmentUrls[message.id], '_blank', 'noopener,noreferrer');
  } catch (openError) {
    message.attachmentError = toErrorMessage(openError, '附件打开失败');
    setChatFeedback('error', message.attachmentError);
  }
};

const loadAttachment = async message => {
  clearChatFeedback();
  try {
    await ensureAttachment(message);
    message.attachmentError = '';
  } catch (attachmentError) {
    message.attachmentError = toErrorMessage(attachmentError, '附件加载失败');
    setChatFeedback('error', message.attachmentError);
  }
};

const loadAdmin = async () => {
  if (!currentUser.value.isAdmin) {
    return;
  }

  adminLoading.value = true;
  clearAdminFeedback();
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
    setAdminFeedback('error', toErrorMessage(adminError, '后台数据加载失败'));
  } finally {
    adminLoading.value = false;
  }
};

const openAdmin = async () => {
  adminOpen.value = true;
  await loadAdmin();
};

const closeAdmin = () => {
  adminOpen.value = false;
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

  clearConversationKeyCache();
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
  clearConversationKeyCache();

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
    try {
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
    } catch (eventError) {
      setChatFeedback('error', toErrorMessage(eventError, '新消息处理失败'));
    }
  });
  registerEvent(CbEvents.OnNewRecvMessageRevoked, async () => {
    try {
      if (activeUserId.value) {
        await loadConversationMessages(activeUserId.value);
      }
    } catch (eventError) {
      setChatFeedback('error', toErrorMessage(eventError, '撤回消息同步失败'));
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
    setChatFeedback('error', toErrorMessage(mountError, '聊天服务连接失败'));
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  for (const [event, handler] of eventBindings) {
    sdk.off(event, handler);
  }

  for (const messageId of Object.keys(attachmentUrls)) {
    revokeAttachmentUrl(messageId);
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
        <ContactSidebar
          :current-user="currentUser"
          :connection-status="connectionStatus"
          :contact-cards="contactCards"
          :active-user-id="activeUserId"
          @select-contact="selectUser"
        />
      </aside>

      <main class="chat-pane" :class="{ mobileHidden: mobileSection !== 'chat' }">
        <ConversationPanel
          :loading="loading"
          :loading-messages="loadingMessages"
          :sending="sending"
          :active-contact="activeContact"
          :displayed-messages="activeMessages"
          :attachment-urls="attachmentUrls"
          :composer="composer"
          :show-emoji="showEmoji"
          :feedback="chatFeedback"
          :encryption-notice="encryptionNotice"
          @back="mobileSection = 'contacts'"
          @send-file="sendFile"
          @update:composer="composer = $event"
          @toggle-emoji="showEmoji = !showEmoji"
          @send-text="sendText"
          @load-attachment="loadAttachment"
          @open-file="openFile"
          @revoke="revoke"
        />
      </main>

      <aside class="right-pane" :class="{ mobileHidden: mobileSection !== 'settings' }">
        <ProfileSettingsPanel
          :current-user="currentUser"
          :profile-form="profileForm"
          :credentials-form="credentialsForm"
          :feedback="settingsFeedback"
          :session-locked="sessionLocked"
          :has-local-private-key="hasLocalPrivateKey"
          :unlock-password="unlockPassword"
          :setup-password="setupPassword"
          :credentials-loading="credentialsLoading"
          @back="mobileSection = 'chat'"
          @save-profile="saveProfile"
          @update-credentials="updateCredentials"
          @update:unlockPassword="unlockPassword = $event"
          @update:setupPassword="setupPassword = $event"
          @unlock-encryption="unlockEncryption"
          @setup-encryption="setupEncryption"
          @open-admin="openAdmin"
          @logout="logout"
        />
      </aside>
    </div>

    <div class="mobile-tabs">
      <button :class="{ active: mobileSection === 'contacts' }" type="button" @click="mobileSection = 'contacts'">联系人</button>
      <button :class="{ active: mobileSection === 'chat' }" type="button" @click="mobileSection = 'chat'">聊天</button>
      <button :class="{ active: mobileSection === 'settings' }" type="button" @click="mobileSection = 'settings'">设置</button>
    </div>

    <AdminWorkspace
      :open="adminOpen"
      :loading="adminLoading"
      :feedback="adminFeedback"
      :summary="adminData.summary"
      :users="adminData.users"
      :logins="adminData.logins"
      :security="adminData.security"
      :system="adminData.system"
      :online-state-value="OnlineState.Online"
      @close="closeAdmin"
      @refresh="loadAdmin"
    />
  </div>
</template>
