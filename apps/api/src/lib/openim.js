import { config } from '../config.js';
import { createOperationId } from './utils.js';

let cachedAdminToken = '';
let cachedAdminTokenExpiresAt = 0;

const requestJson = async ({ path, body, token }) => {
  const response = await fetch(`${config.openimApiUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      operationID: createOperationId(),
      ...(token ? { token } : {})
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json();
  if (!response.ok || payload.errCode !== 0) {
    throw new Error(payload.errMsg || `OpenIM request failed: ${path}`);
  }

  return payload.data || null;
};

export const getAdminToken = async () => {
  if (cachedAdminToken && cachedAdminTokenExpiresAt > Date.now() + 60_000) {
    return cachedAdminToken;
  }

  const data = await requestJson({
    path: '/auth/get_admin_token',
    body: {
      secret: config.openimSecret,
      userID: config.openimAdminUserId
    }
  });

  cachedAdminToken = data.token;
  cachedAdminTokenExpiresAt = Date.now() + Number(data.expireTimeSeconds || 0) * 1000;
  return cachedAdminToken;
};

export const registerOpenImUser = async ({ userId, nickname, avatarUrl }) => {
  const adminToken = await getAdminToken();
  await requestJson({
    path: '/user/user_register',
    token: adminToken,
    body: {
      users: [
        {
          userID: userId,
          nickname,
          faceURL: avatarUrl || ''
        }
      ]
    }
  });
};

const isDuplicateUserError = error =>
  /already|exist|duplicate|registered|has been/i.test(error.message || '');

export const ensureOpenImUser = async ({ userId, nickname, avatarUrl }) => {
  try {
    await registerOpenImUser({ userId, nickname, avatarUrl });
  } catch (error) {
    if (!isDuplicateUserError(error)) {
      throw error;
    }
  }
};

export const getOpenImUserToken = async userId => {
  const adminToken = await getAdminToken();
  const data = await requestJson({
    path: '/auth/get_user_token',
    token: adminToken,
    body: {
      platformID: config.platformId,
      userID: userId
    }
  });

  return data.token;
};

export const updateOpenImUser = async ({ userId, nickname, avatarUrl }) => {
  const adminToken = await getAdminToken();
  await requestJson({
    path: '/user/update_user_info_ex',
    token: adminToken,
    body: {
      userInfo: {
        userID: userId,
        nickname,
        faceURL: avatarUrl || ''
      }
    }
  });
};

export const getOpenImUserStatuses = async userIds => {
  if (!userIds.length) {
    return [];
  }

  const adminToken = await getAdminToken();
  const data = await requestJson({
    path: '/user/get_users_online_status',
    token: adminToken,
    body: {
      userIDs: userIds
    }
  });

  return data?.successResult || [];
};

export const checkOpenImStatus = async () => {
  try {
    await getAdminToken();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};
