import KnowledgeBase from '../models/KnowledgeBase.js';
import Document from '../models/Document.js';

// @desc    Create a new knowledge base
// @route   POST /api/kbs
// @access  Private
export const createKB = async (req, res, next) => {
  try {
    const { name, description } = req.body;

    const kb = await KnowledgeBase.create({
      name,
      description,
      owner: req.user._id,
    });

    res.status(201).json({
      status: 'success',
      data: kb,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all knowledge bases for logged in user
// @route   GET /api/kbs
// @access  Private
export const getKBs = async (req, res, next) => {
  try {
    const kbs = await KnowledgeBase.find({ owner: req.user._id }).sort('-createdAt');

    res.status(200).json({
      status: 'success',
      count: kbs.length,
      data: kbs,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single knowledge base
// @route   GET /api/kbs/:id
// @access  Private
export const getKB = async (req, res, next) => {
  try {
    const kb = await KnowledgeBase.findOne({ _id: req.params.id, owner: req.user._id });

    if (!kb) {
      res.status(404);
      throw new Error('Knowledge Base not found');
    }

    res.status(200).json({
      status: 'success',
      data: kb,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update knowledge base
// @route   PUT /api/kbs/:id
// @access  Private
export const updateKB = async (req, res, next) => {
  try {
    let kb = await KnowledgeBase.findOne({ _id: req.params.id, owner: req.user._id });

    if (!kb) {
      res.status(404);
      throw new Error('Knowledge Base not found');
    }

    const { name, description } = req.body;

    kb.name = name || kb.name;
    kb.description = description || kb.description;

    await kb.save();

    res.status(200).json({
      status: 'success',
      data: kb,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete knowledge base
// @route   DELETE /api/kbs/:id
// @access  Private
export const deleteKB = async (req, res, next) => {
  try {
    const kb = await KnowledgeBase.findOne({ _id: req.params.id, owner: req.user._id });

    if (!kb) {
      res.status(404);
      throw new Error('Knowledge Base not found');
    }

    // Also delete all documents associated with this KB
    await Document.deleteMany({ knowledgeBaseId: kb._id });
    
    await kb.deleteOne();

    res.status(200).json({
      status: 'success',
      message: 'Knowledge Base deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
