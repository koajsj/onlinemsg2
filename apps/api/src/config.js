import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..', '..', '..');
const dataDir = path.resolve(appRoot, process.env.APP_DATA_DIR || 'data/runtime');
const uploadDir = path.resolve(appRoot, process.env.APP_UPLOAD_DIR || 'data/uploads');

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const splitOrigins = (value, fallback) =>
  (value || fallback)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

export const config = {
  appRoot,
  dataDir,
  uploadDir,
  port: Number(process.env.APP_API_PORT || 18000),
  jwtSecret: (() => {
    const secret = process.env.APP_JWT_SECRET;
    if (!secret) {
      console.error('FATAL: APP_JWT_SECRET is not set. Refusing to start with an auto-generated secret (tokens would invalidate on every restart). Set APP_JWT_SECRET in your .env file.');
      process.exit(1);
    }
    return secret;
  })(),
  jwtExpiresIn: process.env.APP_JWT_EXPIRES_IN || '12h',
  openimApiUrl: (process.env.OPENIM_API_URL || 'http://127.0.0.1:10002').replace(/\/$/, ''),
  openimSecret: process.env.OPENIM_SECRET || '',
  openimAdminUserId: process.env.OPENIM_ADMIN_USER_ID || 'imAdmin',
  platformId: Number(process.env.OPENIM_PLATFORM_ID || 5),
  frontendOrigins: splitOrigins(process.env.APP_ALLOWED_ORIGINS, 'http://127.0.0.1:8080,http://localhost:8080,http://127.0.0.1:5173,http://localhost:5173'),
  maxUploadSize: Number(process.env.APP_MAX_UPLOAD_SIZE || 15 * 1024 * 1024),
  maxAttachmentSize: Number(process.env.APP_MAX_ATTACHMENT_SIZE || 25 * 1024 * 1024),
  defaultAdminUsername: process.env.DEFAULT_ADMIN_USERNAME || '',
  defaultAdminPassword: process.env.DEFAULT_ADMIN_PASSWORD || '',
  version: process.env.APP_VERSION || '1.0.0',
  domain: process.env.APP_DOMAIN || '257823.xyz'
};
