import express from 'express';

const router = express.Router();

// Health Check Endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Enterprise Knowledge Intelligence API is running',
    timestamp: new Date().toISOString()
  });
});

export default router;
