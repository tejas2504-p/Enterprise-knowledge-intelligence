import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import KnowledgeBase from '../models/KnowledgeBase.js';
import Document from '../models/Document.js';
import { storageProvider } from '../services/storageProvider.js';
import { documentProcessingService } from '../services/documentProcessingService.js';
import { deleteDocumentFromAI } from '../services/aiServiceClient.js';
import {
  canUserDeleteDocument,
  canUserReadDocument,
  canUserViewKB,
} from '../utils/accessControl.js';

// @desc    Upload document to a KB
// @route   POST /api/knowledge-bases/:knowledgeBaseId/documents
// @access  Private
export const uploadDocument = async (req, res, next) => {
  try {
    const { knowledgeBaseId } = req.params;

    if (!knowledgeBaseId) {
      res.status(400);
      throw new Error('Knowledge Base ID is required');
    }

    if (!req.file) {
      res.status(400);
      throw new Error('Please upload a file');
    }

    // Check if KB exists and user is authorized
    const kb = await KnowledgeBase.findById(knowledgeBaseId);
    if (!kb) {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(404);
      throw new Error('Knowledge Base not found');
    }

    if (!canUserViewKB(req.user, kb)) {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(403);
      throw new Error('Not authorized to access this Knowledge Base');
    }

    // Process storage using modular provider
    let fileInfo;
    try {
      fileInfo = await storageProvider.uploadFile(
        req.file.path, // Temp file path
        req.file.originalname,
        req.file.mimetype
      );
    } catch (storageError) {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500);
      throw new Error('Failed to store file: ' + storageError.message);
    }

    try {
      const allowedVisibilities = ['private', 'public', 'restricted'];
      const visibility = allowedVisibilities.includes(req.body?.visibility)
        ? req.body.visibility
        : kb.visibility === 'private'
          ? 'private'
          : 'public';

      // Create Document record inheriting KB metadata
      const doc = await Document.create({
        title: req.body.title || req.file.originalname,
        originalFileName: req.file.originalname,
        fileType: path.extname(req.file.originalname).toLowerCase().replace('.', ''),
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        storageProvider: fileInfo.provider,
        storageKey: fileInfo.storageKey,
        url: fileInfo.url,
        knowledgeBase: kb._id,
        department: kb.department || null,
        visibility,
        uploadedBy: req.user._id,
        processingStatus: 'uploaded',
      });

      // Update Knowledge Base stats
      kb.documentCount += 1;
      kb.totalSize += req.file.size;
      await kb.save();

      // Trigger asynchronous text extraction processing (Phase 2)
      documentProcessingService.processDocument(doc._id).catch((err) => {
        console.error('Background processing error:', err);
      });

      res.status(201).json({
        status: 'success',
        data: doc,
      });
    } catch (dbError) {
      await storageProvider.deleteFile(fileInfo.storageKey);
      res.status(500);
      throw new Error('Failed to save document metadata: ' + dbError.message);
    }
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {}
    }
    next(error);
  }
};

// @desc    Get authorized documents for a KB
// @route   GET /api/knowledge-bases/:knowledgeBaseId/documents
// @access  Private
export const getDocumentsByKB = async (req, res, next) => {
  try {
    const { knowledgeBaseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(knowledgeBaseId)) {
      res.status(400);
      throw new Error('Invalid Knowledge Base ID format');
    }

    const kb = await KnowledgeBase.findById(knowledgeBaseId);
    if (!kb) {
      res.status(404);
      throw new Error('Knowledge Base not found');
    }

    if (!canUserViewKB(req.user, kb)) {
      res.status(403);
      throw new Error('Not authorized to access this Knowledge Base');
    }

    const docs = await Document.find({ knowledgeBase: knowledgeBaseId })
      .sort('-createdAt')
      .populate('uploadedBy', 'name email');

    const authorizedDocs = docs.filter((doc) => canUserReadDocument(req.user, doc, kb));

    res.status(200).json({
      status: 'success',
      count: authorizedDocs.length,
      data: authorizedDocs,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single document
// @route   GET /api/documents/:id
// @access  Private
export const getDocument = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400);
      throw new Error('Invalid Document ID format');
    }

    const doc = await Document.findById(req.params.id).populate('uploadedBy', 'name email');

    if (!doc) {
      res.status(404);
      throw new Error('Document not found');
    }

    const kb = await KnowledgeBase.findById(doc.knowledgeBase);
    if (!kb) {
      res.status(404);
      throw new Error('Associated Knowledge Base not found');
    }

    if (!canUserReadDocument(req.user, doc, kb)) {
      res.status(403);
      throw new Error('Not authorized to access this Document');
    }

    res.status(200).json({
      status: 'success',
      data: doc,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete document
// @route   DELETE /api/documents/:id
// @access  Private
export const deleteDocument = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400);
      throw new Error('Invalid Document ID format');
    }

    const doc = await Document.findById(req.params.id);

    if (!doc) {
      res.status(404);
      throw new Error('Document not found');
    }

    const kb = await KnowledgeBase.findById(doc.knowledgeBase);

    if (!canUserDeleteDocument(req.user, doc, kb)) {
      res.status(403);
      throw new Error('Not authorized to delete this Document');
    }

    // Remove file from storage provider
    if (doc.storageKey) {
      await storageProvider.deleteFile(doc.storageKey);
    } else if (doc.url && fs.existsSync(doc.url)) {
      try {
        fs.unlinkSync(doc.url);
      } catch (e) {
        console.error('Error deleting file:', e);
      }
    }

    // Remove from AI Service / Vector DB
    try {
      await deleteDocumentFromAI(doc._id.toString());
    } catch (e) {
      console.error('Failed to delete document from AI service:', e);
    }

    await doc.deleteOne();

    if (kb) {
      kb.documentCount = Math.max(0, kb.documentCount - 1);
      kb.totalSize = Math.max(0, kb.totalSize - doc.fileSize);
      await kb.save();
    }

    res.status(200).json({
      status: 'success',
      message: 'Document deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Trigger re-indexing of an existing processed document
// @route   POST /api/documents/:id/index
// @access  Private
export const reindexDocument = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400);
      throw new Error('Invalid Document ID format');
    }

    const doc = await Document.findById(req.params.id);

    if (!doc) {
      res.status(404);
      throw new Error('Document not found');
    }

    const kb = await KnowledgeBase.findById(doc.knowledgeBase);
    if (!kb) {
      res.status(404);
      throw new Error('Associated Knowledge Base not found');
    }

    if (!canUserReadDocument(req.user, doc, kb)) {
      res.status(403);
      throw new Error('Not authorized to access this Document');
    }

    const updatedDoc = await documentProcessingService.indexExistingDocument(doc._id);

    res.status(200).json({
      status: 'success',
      data: updatedDoc,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Batch re-index multiple documents
// @route   POST /api/documents/batch-index
// @access  Private
export const batchIndexDocuments = async (req, res, next) => {
  try {
    const { document_ids } = req.body;

    if (!document_ids || !Array.isArray(document_ids) || document_ids.length === 0) {
      res.status(400);
      throw new Error('Please provide an array of document_ids');
    }

    const docs = await Document.find({ _id: { $in: document_ids } }).populate('knowledgeBase');
    const authorizedIds = docs
      .filter((doc) => doc.knowledgeBase && canUserReadDocument(req.user, doc, doc.knowledgeBase))
      .map((doc) => doc._id.toString());

    if (authorizedIds.length === 0) {
      res.status(403);
      throw new Error('Not authorized to index any of the specified documents');
    }

    const results = await documentProcessingService.batchIndexDocuments(authorizedIds);

    res.status(200).json({
      status: 'success',
      data: results,
    });
  } catch (error) {
    next(error);
  }
};
