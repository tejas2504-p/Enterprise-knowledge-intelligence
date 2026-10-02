import express from 'express';
import { createKB, getKBs, getKB, updateKB, deleteKB } from '../controllers/kbController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(protect);

router.route('/')
  .get(getKBs)
  .post(createKB);

router.route('/:id')
  .get(getKB)
  .put(updateKB)
  .delete(deleteKB);

export default router;
