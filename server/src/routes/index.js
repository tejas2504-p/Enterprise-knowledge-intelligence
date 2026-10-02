import express from 'express';
import authRoutes from './authRoutes.js';
import kbRoutes from './kbRoutes.js';
import docRoutes from './docRoutes.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/kbs', kbRoutes);
router.use('/documents', docRoutes);

// Health Check Endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Enterprise Knowledge Intelligence API is running',
    timestamp: new Date().toISOString()
  });
});

export default router;
