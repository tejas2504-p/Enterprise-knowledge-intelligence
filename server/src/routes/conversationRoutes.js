import express from 'express';
import {
  getConversations,
  getConversationById,
  deleteConversation,
} from '../controllers/ragController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

router.get('/', getConversations);
router.route('/:id').get(getConversationById).delete(deleteConversation);

export default router;
