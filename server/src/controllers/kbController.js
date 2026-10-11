import mongoose from 'mongoose';
import KnowledgeBase from '../models/KnowledgeBase.js';
import Document from '../models/Document.js';
import { deleteKnowledgeBaseFromAI } from '../services/aiServiceClient.js';

/**
 * Helper to check whether user has modification permission on a Knowledge Base.
 * Rules:
 * - Creator/Owner of the KB has modification permission.
 * - Platform admins (role: 'admin') have modification permission.
 */
const canUserModifyKB = (user, kb) => {
  if (!user || !kb) return false;
  if (user.role === 'admin') return true;
  const ownerId = kb.owner?._id ? kb.owner._id.toString() : kb.owner?.toString();
  return ownerId === user._id.toString();
};

/**
 * Helper to check whether user has read permission on a Knowledge Base.
 * Rules:
 * - Owner and admins always have access.
 * - 'organization' visibility is accessible to any authenticated user in the organization.
 * - 'department' visibility is accessible if user's department matches kb's department.
 * - 'private' visibility is only accessible to owner or admin.
 */
const canUserViewKB = (user, kb) => {
  if (!user || !kb) return false;
  if (user.role === 'admin') return true;

  const ownerId = kb.owner?._id ? kb.owner._id.toString() : kb.owner?.toString();
  if (ownerId === user._id.toString()) return true;

  if (kb.visibility === 'organization') return true;

  if (kb.visibility === 'department' && user.department && kb.department === user.department) {
    return true;
  }

  return false;
};

// @desc    Create a new knowledge base
// @route   POST /api/knowledge-bases
// @access  Private
export const createKB = async (req, res, next) => {
  try {
    const { name, description, organization, department, visibility, status } = req.body;

    const kb = await KnowledgeBase.create({
      name: name.trim(),
      description: description !== undefined ? description.trim() : '',
      organization: organization !== undefined ? (organization ? organization.trim() : null) : null,
      department: department !== undefined ? (department ? department.trim() : null) : (req.user.department || null),
      visibility: visibility || 'private',
      status: status || 'active',
      owner: req.user._id,
    });

    // Populate owner info for consistent response
    await kb.populate('owner', 'name email department avatar');

    res.status(201).json({
      status: 'success',
      data: kb,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all accessible knowledge bases
// @route   GET /api/knowledge-bases
// @access  Private
export const getKBs = async (req, res, next) => {
  try {
    // 1. Determine base visibility / access conditions based on user role and permissions
    let accessCondition;
    if (req.user.role === 'admin') {
      accessCondition = {};
    } else {
      const allowedConditions = [
        { owner: req.user._id },
        { visibility: 'organization' },
      ];

      if (req.user.department) {
        allowedConditions.push({
          visibility: 'department',
          department: req.user.department,
        });
      }

      accessCondition = { $or: allowedConditions };
    }

    // 2. Build filters from query parameters
    const filterConditions = {};

    if (req.query.visibility) {
      filterConditions.visibility = req.query.visibility;
    }

    if (req.query.status) {
      filterConditions.status = req.query.status;
    }

    if (req.query.department) {
      filterConditions.department = req.query.department;
    }

    if (req.query.organization) {
      filterConditions.organization = req.query.organization;
    }

    if (req.query.owner === 'me') {
      filterConditions.owner = req.user._id;
    }

    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      filterConditions.$or = [
        { name: searchRegex },
        { description: searchRegex },
      ];
    }

    // 3. Combine access condition with filter conditions
    let query;
    if (Object.keys(accessCondition).length > 0 && Object.keys(filterConditions).length > 0) {
      query = { $and: [accessCondition, filterConditions] };
    } else if (Object.keys(accessCondition).length > 0) {
      query = accessCondition;
    } else {
      query = filterConditions;
    }

    const kbs = await KnowledgeBase.find(query)
      .sort('-createdAt')
      .populate('owner', 'name email department avatar');

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
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid Knowledge Base ID format',
      });
    }

    const kb = await KnowledgeBase.findById(id).populate('owner', 'name email department avatar');

    if (!kb) {
      return res.status(404).json({
        status: 'fail',
        message: 'Knowledge Base not found',
      });
    }

    // Check read permissions
    if (!canUserViewKB(req.user, kb)) {
      return res.status(403).json({
        status: 'fail',
        message: 'Not authorized to access this Knowledge Base',
      });
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
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid Knowledge Base ID format',
      });
    }

    const kb = await KnowledgeBase.findById(id);

    if (!kb) {
      return res.status(404).json({
        status: 'fail',
        message: 'Knowledge Base not found',
      });
    }

    // Check modification permission
    if (!canUserModifyKB(req.user, kb)) {
      return res.status(403).json({
        status: 'fail',
        message: 'Not authorized to modify this Knowledge Base',
      });
    }

    const { name, description, organization, department, visibility, status } = req.body;

    if (name !== undefined) kb.name = name.trim();
    if (description !== undefined) kb.description = description ? description.trim() : '';
    if (organization !== undefined) kb.organization = organization ? organization.trim() : null;
    if (department !== undefined) kb.department = department ? department.trim() : null;
    if (visibility !== undefined) kb.visibility = visibility;
    if (status !== undefined) kb.status = status;

    await kb.save();
    await kb.populate('owner', 'name email department avatar');

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
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid Knowledge Base ID format',
      });
    }

    const kb = await KnowledgeBase.findById(id);

    if (!kb) {
      return res.status(404).json({
        status: 'fail',
        message: 'Knowledge Base not found',
      });
    }

    // Check modification/deletion permission
    if (!canUserModifyKB(req.user, kb)) {
      return res.status(403).json({
        status: 'fail',
        message: 'Not authorized to delete this Knowledge Base',
      });
    }

    // Delete associated documents
    await Document.deleteMany({ knowledgeBase: kb._id });

    // Clean up in external AI service if configured
    try {
      await deleteKnowledgeBaseFromAI(kb._id.toString());
    } catch (e) {
      console.warn('Failed to delete knowledge base from AI service:', e.message);
    }

    await kb.deleteOne();

    res.status(200).json({
      status: 'success',
      message: 'Knowledge Base deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
