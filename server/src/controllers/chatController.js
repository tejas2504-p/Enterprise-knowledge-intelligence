import { queryRag } from './ragController.js';

// @desc    Chat with AI using RAG (delegates to unified RAG controller)
// @route   POST /api/chat
// @access  Private
export const chat = queryRag;
