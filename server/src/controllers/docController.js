import fs from 'fs';
import path from 'path';
import KnowledgeBase from '../models/KnowledgeBase.js';
import Document from '../models/Document.js';
import { storageProvider } from '../services/storageProvider.js';

import { documentProcessingService } from '../services/documentProcessingService.js';

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

    // Check if KB exists and belongs to user or accessible
    const kb = await KnowledgeBase.findById(knowledgeBaseId);
    if (!kb) {
      // Clean up uploaded temp file
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(404);
      throw new Error('Knowledge Base not found');
    }

    if (kb.owner.toString() !== req.user._id.toString() && kb.visibility === 'private') {
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
      // Create Document record
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
        uploadedBy: req.user._id,
        processingStatus: 'uploaded',
      });

      // Update Knowledge Base stats
      kb.documentCount += 1;
      kb.totalSize += req.file.size;
      await kb.save();

      // Trigger asynchronous text extraction processing (Phase 2)
      documentProcessingService.processDocument(doc._id).catch(err => {
        console.error('Background processing error:', err);
      });

      res.status(201).json({
        status: 'success',
        data: doc,
      });
    } catch (dbError) {
      // Clean up file if database creation fails
      await storageProvider.deleteFile(fileInfo.storageKey);
      res.status(500);
      throw new Error('Failed to save document metadata: ' + dbError.message);
    }
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch(e) {}
    }
    next(error);
  }
};

// @desc    Get documents for a KB
// @route   GET /api/knowledge-bases/:knowledgeBaseId/documents
// @access  Private
export const getDocumentsByKB = async (req, res, next) => {
  try {
    const { knowledgeBaseId } = req.params;

    const kb = await KnowledgeBase.findById(knowledgeBaseId);
    if (!kb) {
      res.status(404);
      throw new Error('Knowledge Base not found');
    }

    if (kb.owner.toString() !== req.user._id.toString() && kb.visibility === 'private') {
      res.status(403);
      throw new Error('Not authorized to access this Knowledge Base');
    }

    const docs = await Document.find({ knowledgeBase: knowledgeBaseId }).sort('-createdAt').populate('uploadedBy', 'name email');

    res.status(200).json({
      status: 'success',
      count: docs.length,
      data: docs,
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

    if (kb.owner.toString() !== req.user._id.toString() && kb.visibility === 'private') {
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
    const doc = await Document.findById(req.params.id);

    if (!doc) {
      res.status(404);
      throw new Error('Document not found');
    }

    const kb = await KnowledgeBase.findById(doc.knowledgeBase);
    
    // Only allow deletion if user owns the document or the KB
    if (doc.uploadedBy.toString() !== req.user._id.toString() && (!kb || kb.owner.toString() !== req.user._id.toString())) {
      res.status(403);
      throw new Error('Not authorized to delete this Document');
    }

    // Remove file from storage provider
    if (doc.storageKey) {
      await storageProvider.deleteFile(doc.storageKey);
    } else if (doc.url && fs.existsSync(doc.url)) { // Fallback for old local files if any
      try {
        fs.unlinkSync(doc.url);
      } catch (e) {
        console.error('Error deleting file:', e);
      }
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
