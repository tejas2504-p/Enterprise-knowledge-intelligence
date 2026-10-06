import fs from 'fs';
import path from 'path';
import multer from 'multer';
import KnowledgeBase from '../models/KnowledgeBase.js';
import Document from '../models/Document.js';

// Setup multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

export const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

// @desc    Upload document to a KB
// @route   POST /api/documents/upload
// @access  Private
export const uploadDocument = async (req, res, next) => {
  try {
    const { kbId } = req.body;
    
    if (!kbId) {
      res.status(400);
      throw new Error('Knowledge Base ID is required');
    }

    if (!req.file) {
      res.status(400);
      throw new Error('Please upload a file');
    }

    // Check if KB exists and belongs to user or accessible
    const kb = await KnowledgeBase.findById(kbId);
    if (!kb) {
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      res.status(404);
      throw new Error('Knowledge Base not found');
    }

    if (kb.owner.toString() !== req.user._id.toString() && kb.visibility === 'private') {
      fs.unlinkSync(req.file.path);
      res.status(403);
      throw new Error('Not authorized to access this Knowledge Base');
    }

    const doc = await Document.create({
      title: req.body.title || req.file.originalname,
      originalFileName: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      knowledgeBase: kb._id,
      uploadedBy: req.user._id,
      processingStatus: 'uploaded',
      url: req.file.path,
    });

    res.status(201).json({
      status: 'success',
      data: doc,
    });
  } catch (error) {
    if (req.file) {
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

    const docs = await Document.find({ knowledgeBase: knowledgeBaseId }).sort('-createdAt');

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

    // Remove file from filesystem if it's a local file
    if (doc.url && fs.existsSync(doc.url)) {
      try {
        fs.unlinkSync(doc.url);
      } catch (e) {
        console.error('Error deleting file:', e);
      }
    }

    await doc.deleteOne();

    res.status(200).json({
      status: 'success',
      message: 'Document deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
