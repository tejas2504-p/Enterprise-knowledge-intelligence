import mongoose from 'mongoose';

/**
 * KnowledgeBase Model
 * Represents a logical grouping of documents and knowledge assets within an organization or department.
 */
const knowledgeBaseSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a knowledge base name'],
      trim: true,
      maxlength: [100, 'Name cannot be more than 100 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot be more than 500 characters'],
      default: '',
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Knowledge base must have an owner'],
    },
    organization: {
      type: String,
      trim: true,
      default: null,
    },
    department: {
      type: String,
      trim: true,
      default: null,
    },
    visibility: {
      type: String,
      enum: {
        values: ['private', 'department', 'organization'],
        message: 'Visibility must be either private, department, or organization',
      },
      default: 'private',
    },
    status: {
      type: String,
      enum: {
        values: ['active', 'archived'],
        message: 'Status must be either active or archived',
      },
      default: 'active',
    },
    documentCount: {
      type: Number,
      default: 0,
      min: [0, 'Document count cannot be negative'],
    },
    totalSize: {
      type: Number,
      default: 0,
      min: [0, 'Total size cannot be negative'],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for query performance and relational lookups
knowledgeBaseSchema.index({ owner: 1 });
knowledgeBaseSchema.index({ department: 1 });
knowledgeBaseSchema.index({ organization: 1 });
knowledgeBaseSchema.index({ createdAt: -1 });

// Compound indexes for multi-tenant and visibility queries
knowledgeBaseSchema.index({ visibility: 1, department: 1 });
knowledgeBaseSchema.index({ visibility: 1, organization: 1 });
knowledgeBaseSchema.index({ owner: 1, createdAt: -1 });

// Virtual relationship to Document model
knowledgeBaseSchema.virtual('documents', {
  ref: 'Document',
  localField: '_id',
  foreignField: 'knowledgeBase',
});

const KnowledgeBase = mongoose.model('KnowledgeBase', knowledgeBaseSchema);

export default KnowledgeBase;
