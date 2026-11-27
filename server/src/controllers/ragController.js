import mongoose from 'mongoose';
import KnowledgeBase from '../models/KnowledgeBase.js';
import Document from '../models/Document.js';
import Conversation from '../models/Conversation.js';
import { analyzeQueryInAI, queryRagInAI } from '../services/aiServiceClient.js';
import { canUserReadDocument, canUserViewKB } from '../utils/accessControl.js';

const INSUFFICIENT_EVIDENCE_FALLBACK =
  'I do not have sufficient evidence in the provided documents to answer this question.';

/**
 * Helper to fetch documents for a Knowledge Base safely in both live Mongoose and mocked test runs.
 */
const fetchKBDocuments = async (kbId) => {
  const result = await Document.find({ knowledgeBase: kbId });
  return Array.isArray(result) ? result : [];
};

const extractConversationHistory = (conversation, maxTurns = 6) => {
  const rawHistory = Array.isArray(conversation?.messages)
    ? conversation.messages.slice(-maxTurns)
    : [];
  return rawHistory
    .filter(
      (m) =>
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim().length > 0
    )
    .map((m) => ({
      role: m.role,
      content: m.content.trim().slice(0, 1500),
    }));
};

/**
 * Normalize incoming RAG query body supporting both canonical (/api/rag/query)
 * and legacy (/api/chat) request shapes without accepting client-supplied user identity.
 */
const normalizeQueryRequest = (body = {}) => {
  const question =
    typeof body.question === 'string'
      ? body.question
      : typeof body.query === 'string'
        ? body.query
        : '';

  const knowledgeBaseId =
    typeof body.knowledgeBaseId === 'string' && body.knowledgeBaseId.trim()
      ? body.knowledgeBaseId.trim()
      : Array.isArray(body.knowledge_base_ids) && typeof body.knowledge_base_ids[0] === 'string'
        ? body.knowledge_base_ids[0].trim()
        : '';

  return {
    question: question.trim(),
    knowledgeBaseId,
    conversationId: body.conversationId || null,
    top_k: body.top_k,
    similarity_threshold: body.similarity_threshold,
  };
};

// @desc    Query Knowledge Base using protected Python RAG engine
// @route   POST /api/rag/query  (and POST /api/chat)
// @access  Private
export const queryRag = async (req, res, next) => {
  try {
    const {
      question,
      knowledgeBaseId,
      conversationId,
      top_k,
      similarity_threshold,
    } = normalizeQueryRequest(req.body);

    if (!question) {
      return res.status(400).json({
        status: 'fail',
        message: 'Question is required and cannot be empty',
      });
    }

    if (question.length > 4000) {
      return res.status(400).json({
        status: 'fail',
        message: 'Question cannot exceed 4000 characters',
      });
    }

    if (!knowledgeBaseId || !mongoose.Types.ObjectId.isValid(knowledgeBaseId)) {
      return res.status(400).json({
        status: 'fail',
        message: 'A valid knowledgeBaseId is required',
      });
    }

    // 1. Pre-retrieval Knowledge Base verification
    const kb = await KnowledgeBase.findById(knowledgeBaseId);
    if (!kb) {
      return res.status(404).json({
        status: 'fail',
        message: 'Knowledge Base not found',
      });
    }

    if (!canUserViewKB(req.user, kb)) {
      return res.status(403).json({
        status: 'fail',
        message: 'Not authorized to access this Knowledge Base',
      });
    }

    if (kb.status === 'archived') {
      return res.status(403).json({
        status: 'fail',
        message: 'This Knowledge Base is archived and cannot be queried',
      });
    }

    // 2. Verify conversation ownership if continuing an existing conversation
    let conversation = null;
    if (conversationId) {
      if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        return res.status(400).json({
          status: 'fail',
          message: 'Invalid conversationId format',
        });
      }

      conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        return res.status(404).json({
          status: 'fail',
          message: 'Conversation not found',
        });
      }

      if (conversation.user.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          status: 'fail',
          message: 'Not authorized to access this conversation',
        });
      }

      if (conversation.knowledgeBase.toString() !== kb._id.toString()) {
        return res.status(400).json({
          status: 'fail',
          message: 'Conversation belongs to a different Knowledge Base',
        });
      }
    }

    // 3. Determine user-authorized documents & indexing state in KB
    const docs = await fetchKBDocuments(kb._id);
    const authorizedDocs = docs.filter((doc) => canUserReadDocument(req.user, doc, kb));
    const authorizedDocMap = new Map(
      authorizedDocs.map((doc) => [doc._id.toString(), doc])
    );

    const indexedDocsCount = authorizedDocs.filter(
      (doc) => doc.indexingStatus === 'indexed'
    ).length;
    const processingDocsCount = authorizedDocs.filter(
      (doc) => doc.indexingStatus === 'processing' || doc.indexingStatus === 'pending'
    ).length;
    const failedDocsCount = authorizedDocs.filter(
      (doc) => doc.indexingStatus === 'failed'
    ).length;

    // 4. Collect bounded recent conversation turns for follow-up query resolution
    const conversationHistory = extractConversationHistory(conversation);

    // 5. Call protected Python AI Service with verified server-signed user identity
    const aiResponse = await queryRagInAI({
      question,
      knowledgeBaseId: kb._id.toString(),
      conversationId: conversation ? conversation._id.toString() : null,
      conversation_history: conversationHistory,
      enable_query_understanding: req.body?.enable_query_understanding,
      top_k,
      similarity_threshold,
      user: req.user,
      organizationId: kb.organization || req.user.organization || null,
    });

    // 5. Filter & enrich citations against user-authorized documents in MongoDB
    const rawCitations = Array.isArray(aiResponse?.citations) ? aiResponse.citations : [];
    const safeCitations = rawCitations
      .filter((citation) => authorizedDocMap.has(String(citation.document_id)))
      .map((citation) => {
        const docRecord = authorizedDocMap.get(String(citation.document_id));
        return {
          document_id: citation.document_id,
          filename: citation.filename || docRecord?.originalFileName || null,
          title: docRecord?.title || citation.filename || 'Document',
          fileType: docRecord?.fileType || null,
          chunk_id: citation.chunk_id || null,
          page_number: citation.page_number ?? null,
          excerpt: citation.excerpt,
          score: citation.score,
        };
      });

    // Guard against citation stripping leaking an ungrounded answer when all sources were unauthorized
    const allSourcesFilteredOut = rawCitations.length > 0 && safeCitations.length === 0;
    const finalAnswer = allSourcesFilteredOut
      ? INSUFFICIENT_EVIDENCE_FALLBACK
      : aiResponse?.answer || INSUFFICIENT_EVIDENCE_FALLBACK;

    const baseMetadata = aiResponse?.metadata || {};
    const finalInsufficient =
      Boolean(baseMetadata.insufficient_evidence) || allSourcesFilteredOut;

    const enrichedMetadata = {
      ...baseMetadata,
      knowledge_base_id: kb._id.toString(),
      knowledge_base_name: kb.name,
      insufficient_evidence: finalInsufficient,
      chunks_used: allSourcesFilteredOut ? 0 : (baseMetadata.chunks_used ?? safeCitations.length),
      total_documents: authorizedDocs.length,
      indexed_documents: baseMetadata.indexed_documents ?? indexedDocsCount,
      processing_documents: processingDocsCount,
      failed_documents: failedDocsCount,
      no_indexed_documents:
        Boolean(baseMetadata.no_indexed_documents) ||
        (authorizedDocs.length === 0 || (docs.length > 0 && indexedDocsCount === 0)),
    };

    // 6. Persist conversation history cleanly
    let persistedConversationId = conversation ? conversation._id.toString() : null;
    try {
      const userMsg = {
        role: 'user',
        content: question,
        citations: [],
        createdAt: new Date(),
      };
      const assistantMsg = {
        role: 'assistant',
        content: finalAnswer,
        citations: safeCitations,
        metadata: enrichedMetadata,
        insufficientEvidence: finalInsufficient,
        createdAt: new Date(),
      };

      if (conversation) {
        conversation.messages.push(userMsg, assistantMsg);
        conversation.lastMessageAt = new Date();
        conversation.knowledgeBaseName = kb.name;
        await conversation.save();
        persistedConversationId = conversation._id.toString();
      } else {
        const title = question.length > 80 ? `${question.slice(0, 77)}...` : question;
        const created = await Conversation.create({
          user: req.user._id,
          knowledgeBase: kb._id,
          knowledgeBaseName: kb.name,
          title,
          messages: [userMsg, assistantMsg],
          lastMessageAt: new Date(),
        });
        persistedConversationId = created._id.toString();
      }
    } catch (persistErr) {
      // Do not fail a completed RAG response if history persistence encounters a transient error
      console.warn('Conversation history persistence skipped:', persistErr.message);
    }

    res.status(200).json({
      status: 'success',
      data: {
        answer: finalAnswer,
        citations: safeCitations,
        metadata: enrichedMetadata,
        conversationId: persistedConversationId || aiResponse?.conversationId || null,
      },
    });
  } catch (error) {
    if (error.statusCode) {
      res.status(error.statusCode);
    }
    next(error);
  }
};

// @desc    Analyze and optimize a query using Python Phase 4 Query Understanding service
// @route   POST /api/rag/analyze-query
// @access  Private
export const analyzeQuery = async (req, res, next) => {
  try {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    const knowledgeBaseId =
      typeof req.body?.knowledgeBaseId === 'string' ? req.body.knowledgeBaseId.trim() : null;
    const conversationId = req.body?.conversationId || null;

    if (!question) {
      return res.status(400).json({
        status: 'fail',
        message: 'Question is required and cannot be empty',
      });
    }

    if (question.length > 4000) {
      return res.status(400).json({
        status: 'fail',
        message: 'Question cannot exceed 4000 characters',
      });
    }

    let kb = null;
    if (knowledgeBaseId) {
      if (!mongoose.Types.ObjectId.isValid(knowledgeBaseId)) {
        return res.status(400).json({
          status: 'fail',
          message: 'Invalid knowledgeBaseId format',
        });
      }
      kb = await KnowledgeBase.findById(knowledgeBaseId);
      if (!kb) {
        return res.status(404).json({
          status: 'fail',
          message: 'Knowledge Base not found',
        });
      }
      if (!canUserViewKB(req.user, kb)) {
        return res.status(403).json({
          status: 'fail',
          message: 'Not authorized to access this Knowledge Base',
        });
      }
    }

    let conversationHistory = [];
    if (conversationId) {
      if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        return res.status(400).json({
          status: 'fail',
          message: 'Invalid conversationId format',
        });
      }
      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        return res.status(404).json({
          status: 'fail',
          message: 'Conversation not found',
        });
      }
      if (conversation.user.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          status: 'fail',
          message: 'Not authorized to access this conversation',
        });
      }
      conversationHistory = extractConversationHistory(conversation);
    }

    const analysisResult = await analyzeQueryInAI({
      question,
      knowledgeBaseId: kb ? kb._id.toString() : null,
      knowledge_base_name: kb?.name || null,
      conversationId,
      conversation_history: conversationHistory,
      user: req.user,
      organizationId: kb?.organization || req.user.organization || null,
    });

    res.status(200).json({
      status: 'success',
      data: analysisResult,
    });
  } catch (error) {
    if (error.statusCode) {
      res.status(error.statusCode);
    }
    next(error);
  }
};

// @desc    Get authenticated user's conversation history
// @route   GET /api/conversations
// @access  Private
export const getConversations = async (req, res, next) => {
  try {
    const query = { user: req.user._id };

    if (req.query.knowledgeBaseId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.knowledgeBaseId)) {
        return res.status(400).json({
          status: 'fail',
          message: 'Invalid knowledgeBaseId filter format',
        });
      }
      query.knowledgeBase = req.query.knowledgeBaseId;
    }

    const conversations = await Conversation.find(query)
      .sort('-lastMessageAt')
      .limit(50)
      .select('title knowledgeBase knowledgeBaseName lastMessageAt createdAt messages');

    const formatted = conversations.map((conv) => {
      const msgs = Array.isArray(conv.messages) ? conv.messages : [];
      const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      return {
        _id: conv._id,
        title: conv.title,
        knowledgeBase: conv.knowledgeBase,
        knowledgeBaseName: conv.knowledgeBaseName,
        messageCount: msgs.length,
        lastMessagePreview: lastMsg?.content ? lastMsg.content.slice(0, 120) : '',
        lastMessageAt: conv.lastMessageAt,
        createdAt: conv.createdAt,
      };
    });

    res.status(200).json({
      status: 'success',
      count: formatted.length,
      data: formatted,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get a single conversation with messages & verified citations
// @route   GET /api/conversations/:id
// @access  Private
export const getConversationById = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid Conversation ID format',
      });
    }

    const conversation = await Conversation.findById(id);
    if (!conversation) {
      return res.status(404).json({
        status: 'fail',
        message: 'Conversation not found',
      });
    }

    if (conversation.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        status: 'fail',
        message: 'Not authorized to access this conversation',
      });
    }

    // Re-verify KB read access in case permissions changed
    const kb = await KnowledgeBase.findById(conversation.knowledgeBase);
    if (kb && !canUserViewKB(req.user, kb)) {
      return res.status(403).json({
        status: 'fail',
        message: 'Not authorized to access the Knowledge Base associated with this conversation',
      });
    }

    // Filter persisted citations against current document read permissions
    let messages = conversation.messages || [];
    if (kb) {
      const docs = await fetchKBDocuments(kb._id);
      if (docs.length > 0) {
        const allowedDocIds = new Set(
          docs
            .filter((doc) => canUserReadDocument(req.user, doc, kb))
            .map((doc) => doc._id.toString())
        );

        messages = messages.map((msg) => {
          const plain = typeof msg.toObject === 'function' ? msg.toObject() : { ...msg };
          if (Array.isArray(plain.citations) && plain.citations.length > 0) {
            plain.citations = plain.citations.filter((c) =>
              allowedDocIds.has(String(c.document_id))
            );
          }
          return plain;
        });
      }
    }

    res.status(200).json({
      status: 'success',
      data: {
        _id: conversation._id,
        title: conversation.title,
        knowledgeBase: conversation.knowledgeBase,
        knowledgeBaseName: kb?.name || conversation.knowledgeBaseName,
        messages,
        lastMessageAt: conversation.lastMessageAt,
        createdAt: conversation.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a user's conversation
// @route   DELETE /api/conversations/:id
// @access  Private
export const deleteConversation = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid Conversation ID format',
      });
    }

    const conversation = await Conversation.findById(id);
    if (!conversation) {
      return res.status(404).json({
        status: 'fail',
        message: 'Conversation not found',
      });
    }

    if (conversation.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        status: 'fail',
        message: 'Not authorized to delete this conversation',
      });
    }

    await conversation.deleteOne();

    res.status(200).json({
      status: 'success',
      message: 'Conversation deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
