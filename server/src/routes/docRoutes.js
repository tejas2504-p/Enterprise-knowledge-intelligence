import express from 'express';
import { uploadDocument, upload, getDocument, deleteDocument } from '../controllers/docController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(protect);

router.post('/upload', upload.single('file'), uploadDocument);

router.route('/:id')
  .get(getDocument)
  .delete(deleteDocument);

export default router;
