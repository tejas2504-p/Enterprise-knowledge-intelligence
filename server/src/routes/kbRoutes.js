import express from 'express';
import { createKB, getKBs, getKB, updateKB, deleteKB } from '../controllers/kbController.js';
import { getDocumentsByKB, uploadDocument } from '../controllers/docController.js';
import { protect } from '../middleware/authMiddleware.js';
import { upload } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(protect);

router.route('/')
  .get(getKBs)
  .post(createKB);

router.route('/:id')
  .get(getKB)
  .patch(updateKB)
  .delete(deleteKB);

router.route('/:knowledgeBaseId/documents')
  .get(getDocumentsByKB)
  .post(upload.single('file'), uploadDocument);

export default router;
