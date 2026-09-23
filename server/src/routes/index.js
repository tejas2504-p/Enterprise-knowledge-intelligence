import express from 'express';
import authRoutes from './authRoutes.js';

const router = express.Router();

router.use('/auth', authRoutes);

// Health Check Endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Enterprise Knowledge Intelligence API is running',
    timestamp: new Date().toISOString()
  });
});

export default router;
