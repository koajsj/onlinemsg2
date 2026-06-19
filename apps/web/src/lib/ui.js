const clamp = (value, maxLength = 32) => {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
};

export const formatClockTime = stamp => {
  if (!stamp) {
    return '';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(stamp));
};

export const formatDateTime = stamp => {
  if (!stamp) {
    return '暂无';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(stamp));
};

export const formatConversationTime = stamp => {
  if (!stamp) {
    return '';
  }

  const date = new Date(stamp);
  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  return isSameDay
    ? formatClockTime(stamp)
    : new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit'
      }).format(date);
};

export const formatFileSize = size => {
  const value = Number(size || 0);
  if (value <= 0) {
    return '0 KB';
  }
  if (value >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.ceil(value / 1024))} KB`;
};

export const getOnlineLabel = (status, onlineValue) =>
  status === onlineValue ? '在线' : '离线';

export const getMessagePreview = message => {
  if (!message) {
    return '开始新的加密聊天';
  }

  if (message.kind === 'text') {
    return clamp(message.body || '新消息', 26);
  }

  if (message.kind === 'image') {
    return '图片消息';
  }

  if (message.kind === 'file') {
    return `文件：${clamp(message.fileName || '未命名附件', 16)}`;
  }

  if (message.kind === 'locked') {
    return clamp(message.body || '未解锁的加密消息', 26);
  }

  return '新消息';
};

export const clampText = clamp;
