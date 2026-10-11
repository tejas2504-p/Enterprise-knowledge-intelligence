import { chatWithAI } from '../services/aiServiceClient.js';
import KnowledgeBase from '../models/KnowledgeBase.js';

// @desc    Chat with AI using RAG
// @route   POST /api/chat
// @access  Private
export const chat = async (req, res, next) => {
  try {
    const { query, knowledge_base_ids, chat_history } = req.body;

    if (!query) {
      res.status(400);
      throw new Error('Query is required');
    }

    if (!knowledge_base_ids || !Array.isArray(knowledge_base_ids) || knowledge_base_ids.length === 0) {
      res.status(400);
      throw new Error('At least one knowledge_base_id is required');
    }

    // Verify user has access to all requested knowledge bases
    for (const kbId of knowledge_base_ids) {
      const kb = await KnowledgeBase.findById(kbId);
      if (!kb) {
        res.status(404);
        throw new Error(`Knowledge Base ${kbId} not found`);
      }
      if (kb.owner.toString() !== req.user._id.toString() && kb.visibility === 'private') {
        res.status(403);
        throw new Error(`Not authorized to access Knowledge Base ${kbId}`);
      }
    }

    // Call the AI Service
    const aiResponse = await chatWithAI(query, knowledge_base_ids, chat_history || []);

    res.status(200).json({
      status: 'success',
      data: aiResponse,
    });
  } catch (error) {
    next(error);
  }
};
