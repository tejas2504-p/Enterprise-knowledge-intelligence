import express from 'express';
import { getDocument, deleteDocument } from '../controllers/docController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(protect);

router.route('/:id')
  .get(getDocument)
  .delete(deleteDocument);

export default router;
