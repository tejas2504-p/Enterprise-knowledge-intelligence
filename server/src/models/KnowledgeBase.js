import mongoose from 'mongoose';

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
    },
    owner: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true,
    },
    organization: {
      type: String,
      trim: true,
    },
    department: {
      type: String,
      trim: true,
    },
    visibility: {
      type: String,
      enum: ['private', 'department', 'organization'],
      default: 'private',
    },
    status: {
      type: String,
      enum: ['active', 'archived'],
      default: 'active',
    },
    documentCount: {
      type: Number,
      default: 0,
    },
    totalSize: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

knowledgeBaseSchema.index({ owner: 1 });
knowledgeBaseSchema.index({ department: 1 });
knowledgeBaseSchema.index({ organization: 1 });
knowledgeBaseSchema.index({ createdAt: -1 });

const KnowledgeBase = mongoose.model('KnowledgeBase', knowledgeBaseSchema);

export default KnowledgeBase;
