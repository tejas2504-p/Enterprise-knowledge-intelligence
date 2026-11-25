import express from 'express';
import authRoutes from './authRoutes.js';
import kbRoutes from './kbRoutes.js';
import docRoutes from './docRoutes.js';
import chatRoutes from './chatRoutes.js';
import ragRoutes from './ragRoutes.js';
import conversationRoutes from './conversationRoutes.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/knowledge-bases', kbRoutes);
router.use('/documents', docRoutes);
router.use('/chat', chatRoutes);
router.use('/rag', ragRoutes);
router.use('/conversations', conversationRoutes);

// Health Check Endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Enterprise Knowledge Intelligence API is running',
    timestamp: new Date().toISOString()
  });
});

export default router;
