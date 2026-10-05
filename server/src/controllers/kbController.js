import KnowledgeBase from '../models/KnowledgeBase.js';
import Document from '../models/Document.js';

// @desc    Create a new knowledge base
// @route   POST /api/knowledge-bases
// @access  Private
export const createKB = async (req, res, next) => {
  try {
    const { name, description, organization, department, visibility, status } = req.body;

    const kb = await KnowledgeBase.create({
      name,
      description,
      organization,
      department,
      visibility,
      status,
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
// @route   GET /api/knowledge-bases
// @access  Private
export const getKBs = async (req, res, next) => {
  try {
    // For now, returning only KBs owned by user. Could be expanded for visibility.
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
// @route   GET /api/knowledge-bases/:id
// @access  Private
export const getKB = async (req, res, next) => {
  try {
    const kb = await KnowledgeBase.findById(req.params.id);

    if (!kb) {
      res.status(404);
      throw new Error('Knowledge Base not found');
    }

    // Checking if user owns the KB or if it's accessible based on visibility could be added here
    if (kb.owner.toString() !== req.user._id.toString() && kb.visibility === 'private') {
      res.status(403);
      throw new Error('Not authorized to access this Knowledge Base');
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
// @route   PATCH /api/knowledge-bases/:id
// @access  Private
export const updateKB = async (req, res, next) => {
  try {
    let kb = await KnowledgeBase.findById(req.params.id);

    if (!kb) {
      res.status(404);
      throw new Error('Knowledge Base not found');
    }

    // Users can only modify knowledge bases they have permission to modify
    if (kb.owner.toString() !== req.user._id.toString()) {
      res.status(403);
      throw new Error('Not authorized to modify this Knowledge Base');
    }

    const { name, description, organization, department, visibility, status } = req.body;

    if (name) kb.name = name;
    if (description !== undefined) kb.description = description;
    if (organization !== undefined) kb.organization = organization;
    if (department !== undefined) kb.department = department;
    if (visibility) kb.visibility = visibility;
    if (status) kb.status = status;

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
// @route   DELETE /api/knowledge-bases/:id
// @access  Private
export const deleteKB = async (req, res, next) => {
  try {
    const kb = await KnowledgeBase.findById(req.params.id);

    if (!kb) {
      res.status(404);
      throw new Error('Knowledge Base not found');
    }

    // Users can only modify/delete knowledge bases they have permission to modify
    if (kb.owner.toString() !== req.user._id.toString()) {
      res.status(403);
      throw new Error('Not authorized to delete this Knowledge Base');
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
