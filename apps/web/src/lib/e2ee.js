import { apiBinary, apiRequest } from './api.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PRIVATE_KEY_PREFIX = 'e2ee-private:';
const conversationKeys = new Map();
const privateKeys = new Map();

const randomBytes = length => crypto.getRandomValues(new Uint8Array(length));

const toBase64 = buffer => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const fromBase64 = value => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

const derivePasswordKey = async (password, salt) => {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 120000,
      hash: 'SHA-256'
    },
    material,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  );
};

const privateKeyStorageKey = username => `${PRIVATE_KEY_PREFIX}${username.toLowerCase()}`;

const exportUnlockedPrivateJwk = async username => {
  const privateKey = getUnlockedPrivateKey(username);
  if (!privateKey) {
    return null;
  }

  return crypto.subtle.exportKey('jwk', privateKey);
};

const writePrivateKeyPackage = async (username, privateJwk, password) => {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await derivePasswordKey(password, salt);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(privateJwk))
  );

  localStorage.setItem(
    privateKeyStorageKey(username),
    JSON.stringify({
      salt: toBase64(salt),
      iv: toBase64(iv),
      cipher: toBase64(cipher)
    })
  );
};

export const hasPrivateKeyPackage = username => Boolean(localStorage.getItem(privateKeyStorageKey(username)));
export const isPrivateKeyUnlocked = username => privateKeys.has(username.toLowerCase());

export const generateAndStoreUserKeys = async (username, password) => {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['encrypt', 'decrypt']
  );

  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await derivePasswordKey(password, salt);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(privateJwk))
  );

  localStorage.setItem(
    privateKeyStorageKey(username),
    JSON.stringify({
      salt: toBase64(salt),
      iv: toBase64(iv),
      cipher: toBase64(cipher)
    })
  );

  privateKeys.set(username.toLowerCase(), pair.privateKey);
  return JSON.stringify(publicJwk);
};

export const unlockPrivateKey = async (username, password) => {
  const raw = localStorage.getItem(privateKeyStorageKey(username));
  if (!raw) {
    return false;
  }

  const payload = JSON.parse(raw);
  const key = await derivePasswordKey(password, new Uint8Array(fromBase64(payload.salt)));
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(fromBase64(payload.iv)) },
    key,
    fromBase64(payload.cipher)
  );

  const privateJwk = JSON.parse(decoder.decode(clear));
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    privateJwk,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256'
    },
    true,
    ['decrypt']
  );

  privateKeys.set(username.toLowerCase(), privateKey);
  return true;
};

export const clearUnlockedPrivateKey = username => {
  privateKeys.delete(username.toLowerCase());
};

export const renamePrivateKeyPackage = (currentUsername, nextUsername) => {
  const currentKey = privateKeyStorageKey(currentUsername);
  const nextKey = privateKeyStorageKey(nextUsername);
  const raw = localStorage.getItem(currentKey);

  if (raw && currentKey !== nextKey) {
    localStorage.setItem(nextKey, raw);
    localStorage.removeItem(currentKey);
  }

  const unlocked = privateKeys.get(currentUsername.toLowerCase());
  if (unlocked && currentUsername.toLowerCase() !== nextUsername.toLowerCase()) {
    privateKeys.set(nextUsername.toLowerCase(), unlocked);
    privateKeys.delete(currentUsername.toLowerCase());
  }
};

export const rewrapPrivateKeyPackage = async (username, currentPassword, nextPassword) => {
  const privateJwk =
    (await exportUnlockedPrivateJwk(username)) ||
    (() => null)();

  if (privateJwk) {
    await writePrivateKeyPackage(username, privateJwk, nextPassword);
    return true;
  }

  const raw = localStorage.getItem(privateKeyStorageKey(username));
  if (!raw) {
    return false;
  }

  const payload = JSON.parse(raw);
  const currentKey = await derivePasswordKey(currentPassword, new Uint8Array(fromBase64(payload.salt)));
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(fromBase64(payload.iv)) },
    currentKey,
    fromBase64(payload.cipher)
  );

  await writePrivateKeyPackage(username, JSON.parse(decoder.decode(clear)), nextPassword);
  return true;
};

const getUnlockedPrivateKey = username => privateKeys.get(username.toLowerCase()) || null;

const importPublicKey = async serialized =>
  crypto.subtle.importKey(
    'jwk',
    JSON.parse(serialized),
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256'
    },
    true,
    ['encrypt']
  );

export const getSecureConversationId = (left, right) =>
  [left, right].sort((a, b) => a.localeCompare(b)).join('__');

const exportAesKey = key => crypto.subtle.exportKey('raw', key);

const importAesKey = raw =>
  crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt'
  ]);

const unwrapConversationKey = async (username, wrappedKey) => {
  const privateKey = getUnlockedPrivateKey(username);
  if (!privateKey) {
    return null;
  }

  const raw = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    fromBase64(wrappedKey)
  );

  return importAesKey(raw);
};

export const ensureConversationKey = async ({
  session,
  participants,
  createIfMissing
}) => {
  const secureConversationId = getSecureConversationId(participants[0].userId, participants[1].userId);
  if (conversationKeys.has(secureConversationId)) {
    return {
      secureConversationId,
      key: conversationKeys.get(secureConversationId)
    };
  }

  try {
    const response = await apiRequest(`/keys/${secureConversationId}`, {
      token: session.token
    });
    const key = await unwrapConversationKey(session.user.username, response.keyEnvelope.wrappedKey);
    if (key) {
      conversationKeys.set(secureConversationId, key);
      return { secureConversationId, key };
    }
  } catch (_error) {
    if (!createIfMissing) {
      return { secureConversationId, key: null };
    }
  }

  if (!createIfMissing) {
    return { secureConversationId, key: null };
  }

  const newKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const raw = await exportAesKey(newKey);
  const envelopes = [];

  for (const participant of participants) {
    if (!participant.publicKey) {
      throw new Error(`用户 ${participant.nickname || participant.userId} 尚未配置加密公钥`);
    }
    const publicKey = await importPublicKey(participant.publicKey);
    const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, raw);
    envelopes.push({
      userId: participant.userId,
      wrappedKey: toBase64(wrapped)
    });
  }

  await apiRequest(`/keys/${secureConversationId}`, {
    method: 'PUT',
    token: session.token,
    body: {
      participantIds: participants.map(item => item.userId),
      envelopes
    }
  });

  conversationKeys.set(secureConversationId, newKey);
  return {
    secureConversationId,
    key: newKey
  };
};

export const encryptPayload = async (key, payload) => {
  const iv = randomBytes(12);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(payload))
  );

  return {
    cipher: toBase64(cipher),
    iv: toBase64(iv)
  };
};

export const decryptPayload = async (key, envelope) => {
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(fromBase64(envelope.iv)) },
    key,
    fromBase64(envelope.cipher)
  );
  return JSON.parse(decoder.decode(clear));
};

export const encryptFile = async (file, key) => {
  const iv = randomBytes(12);
  const buffer = await file.arrayBuffer();
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buffer);
  return {
    iv: toBase64(iv),
    bytes: new Uint8Array(cipher)
  };
};

export const decryptFileUrl = async ({ uploadId, iv, key, token, mimeType }) => {
  const bytes = await apiBinary(`/uploads/${uploadId}`, token);
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(fromBase64(iv)) },
    key,
    bytes
  );

  const blob = new Blob([clear], { type: mimeType || 'application/octet-stream' });
  return URL.createObjectURL(blob);
};
