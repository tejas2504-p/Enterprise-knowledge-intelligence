import express from 'express';
import {
  getDocument,
  deleteDocument,
  reindexDocument,
  batchIndexDocuments,
} from '../controllers/docController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(protect);

router.post('/batch-index', batchIndexDocuments);

router.route('/:id')
  .get(getDocument)
  .delete(deleteDocument);

router.post('/:id/index', reindexDocument);

export default router;
