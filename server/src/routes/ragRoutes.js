import express from 'express';
import { queryRag } from '../controllers/ragController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);
router.post('/query', queryRag);

export default router;
