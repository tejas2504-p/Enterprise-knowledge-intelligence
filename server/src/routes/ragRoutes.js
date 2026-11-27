import express from 'express';
import { analyzeQuery, queryRag } from '../controllers/ragController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);
router.post('/query', queryRag);
router.post('/analyze-query', analyzeQuery);

export default router;
