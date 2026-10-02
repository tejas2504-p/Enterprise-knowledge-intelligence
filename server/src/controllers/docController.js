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

    // Check if KB exists and belongs to user
    const kb = await KnowledgeBase.findOne({ _id: kbId, owner: req.user._id });
    if (!kb) {
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      res.status(404);
      throw new Error('Knowledge Base not found or you do not have permission');
    }

    const doc = await Document.create({
      title: req.body.title || req.file.originalname,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      knowledgeBaseId: kb._id,
      uploadedBy: req.user._id,
      status: 'pending', // Will be picked up by the processing pipeline later
      filePath: req.file.path,
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
// @route   GET /api/documents/kb/:kbId
// @access  Private
export const getDocuments = async (req, res, next) => {
  try {
    const { kbId } = req.params;

    const kb = await KnowledgeBase.findOne({ _id: kbId, owner: req.user._id });
    if (!kb) {
      res.status(404);
      throw new Error('Knowledge Base not found');
    }

    const docs = await Document.find({ knowledgeBaseId: kbId }).sort('-createdAt');

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
    const doc = await Document.findOne({ _id: req.params.id, uploadedBy: req.user._id });

    if (!doc) {
      res.status(404);
      throw new Error('Document not found');
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
    const doc = await Document.findOne({ _id: req.params.id, uploadedBy: req.user._id });

    if (!doc) {
      res.status(404);
      throw new Error('Document not found');
    }

    // Remove file from filesystem
    if (fs.existsSync(doc.filePath)) {
      fs.unlinkSync(doc.filePath);
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
