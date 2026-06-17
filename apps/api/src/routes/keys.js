import express from 'express';
import { asyncHandler } from '../middleware/error.js';
import { conversationKeySchema } from '../lib/security.js';
import { getConversationKeyForUser, saveConversationKeys } from '../lib/store.js';

const router = express.Router();

router.get(
  '/:conversationId',
  asyncHandler(async (req, res) => {
    const entry = getConversationKeyForUser({
      conversationId: req.params.conversationId,
      userId: req.user.userId
    });

    if (!entry) {
      res.status(404).json({ message: '会话密钥不存在' });
      return;
    }

    res.json({
      keyEnvelope: {
        conversationId: entry.conversationId,
        wrappedKey: entry.wrappedKey,
        participantIds: entry.participantIds,
        algorithm: entry.algorithm
      }
    });
  })
);

router.put(
  '/:conversationId',
  asyncHandler(async (req, res) => {
    const input = conversationKeySchema.parse(req.body);
    if (!input.participantIds.includes(req.user.userId)) {
      res.status(403).json({ message: '会话参与者不匹配' });
      return;
    }

    await saveConversationKeys({
      conversationId: req.params.conversationId,
      envelopes: input.envelopes,
      participantIds: input.participantIds,
      createdBy: req.user.userId
    });

    res.json({ ok: true });
  })
);

export default router;
