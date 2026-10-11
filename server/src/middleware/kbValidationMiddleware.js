import mongoose from 'mongoose';

const VALID_VISIBILITIES = ['private', 'department', 'organization'];
const VALID_STATUSES = ['active', 'archived'];
const ALLOWED_UPDATE_FIELDS = ['name', 'description', 'organization', 'department', 'visibility', 'status'];

/**
 * Validate MongoDB ObjectId in request parameters
 */
export const validateKBId = (req, res, next) => {
  const { id } = req.params;

  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      status: 'fail',
      message: 'Invalid Knowledge Base ID format',
    });
  }

  next();
};

/**
 * Validate request body for Knowledge Base creation
 */
export const validateCreateKB = (req, res, next) => {
  const { name, description, visibility, status, organization, department } = req.body || {};

  // Validate name (required, string, non-empty, max 100 chars)
  if (name === undefined || name === null || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({
      status: 'fail',
      message: 'Please provide a valid knowledge base name',
    });
  }

  if (name.trim().length > 100) {
    return res.status(400).json({
      status: 'fail',
      message: 'Name cannot be more than 100 characters',
    });
  }

  // Validate description (optional, string, max 500 chars)
  if (description !== undefined && description !== null) {
    if (typeof description !== 'string') {
      return res.status(400).json({
        status: 'fail',
        message: 'Description must be a string',
      });
    }
    if (description.length > 500) {
      return res.status(400).json({
        status: 'fail',
        message: 'Description cannot be more than 500 characters',
      });
    }
  }

  // Validate visibility (optional enum)
  if (visibility !== undefined && visibility !== null) {
    if (!VALID_VISIBILITIES.includes(visibility)) {
      return res.status(400).json({
        status: 'fail',
        message: `Invalid visibility: "${visibility}". Allowed values: ${VALID_VISIBILITIES.join(', ')}`,
      });
    }
  }

  // Validate status (optional enum)
  if (status !== undefined && status !== null) {
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        status: 'fail',
        message: `Invalid status: "${status}". Allowed values: ${VALID_STATUSES.join(', ')}`,
      });
    }
  }

  // Validate organization (optional string or null)
  if (organization !== undefined && organization !== null && typeof organization !== 'string') {
    return res.status(400).json({
      status: 'fail',
      message: 'Organization must be a string',
    });
  }

  // Validate department (optional string or null)
  if (department !== undefined && department !== null && typeof department !== 'string') {
    return res.status(400).json({
      status: 'fail',
      message: 'Department must be a string',
    });
  }

  next();
};

/**
 * Validate request body for Knowledge Base update
 */
export const validateUpdateKB = (req, res, next) => {
  const body = req.body;

  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    return res.status(400).json({
      status: 'fail',
      message: 'Please provide fields to update',
    });
  }

  // Check if at least one allowed field is present
  const hasAllowedField = Object.keys(body).some((key) => ALLOWED_UPDATE_FIELDS.includes(key));
  if (!hasAllowedField) {
    return res.status(400).json({
      status: 'fail',
      message: `No modifiable fields provided. Allowed fields: ${ALLOWED_UPDATE_FIELDS.join(', ')}`,
    });
  }

  const { name, description, visibility, status, organization, department } = body;

  // If name is being updated
  if (name !== undefined) {
    if (name === null || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({
        status: 'fail',
        message: 'Name cannot be empty',
      });
    }
    if (name.trim().length > 100) {
      return res.status(400).json({
        status: 'fail',
        message: 'Name cannot be more than 100 characters',
      });
    }
  }

  // If description is being updated
  if (description !== undefined && description !== null) {
    if (typeof description !== 'string') {
      return res.status(400).json({
        status: 'fail',
        message: 'Description must be a string',
      });
    }
    if (description.length > 500) {
      return res.status(400).json({
        status: 'fail',
        message: 'Description cannot be more than 500 characters',
      });
    }
  }

  // If visibility is being updated
  if (visibility !== undefined && visibility !== null) {
    if (!VALID_VISIBILITIES.includes(visibility)) {
      return res.status(400).json({
        status: 'fail',
        message: `Invalid visibility: "${visibility}". Allowed values: ${VALID_VISIBILITIES.join(', ')}`,
      });
    }
  }

  // If status is being updated
  if (status !== undefined && status !== null) {
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        status: 'fail',
        message: `Invalid status: "${status}". Allowed values: ${VALID_STATUSES.join(', ')}`,
      });
    }
  }

  // If organization is being updated
  if (organization !== undefined && organization !== null && typeof organization !== 'string') {
    return res.status(400).json({
      status: 'fail',
      message: 'Organization must be a string',
    });
  }

  // If department is being updated
  if (department !== undefined && department !== null && typeof department !== 'string') {
    return res.status(400).json({
      status: 'fail',
      message: 'Department must be a string',
    });
  }

  next();
};
