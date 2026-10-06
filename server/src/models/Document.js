import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Please provide a document title'],
      trim: true,
    },
    originalFileName: {
      type: String,
      required: true,
    },
    fileType: {
      type: String,
    },
    mimeType: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number,
      required: true,
    },
    storageProvider: {
      type: String,
      default: 'local',
    },
    storageKey: {
      type: String,
    },
    url: {
      type: String,
    },
    uploadedBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true,
    },
    knowledgeBase: {
      type: mongoose.Schema.ObjectId,
      ref: 'KnowledgeBase',
      required: true,
    },
    department: {
      type: String,
    },
    visibility: {
      type: String,
      enum: ['private', 'public', 'restricted'],
      default: 'private',
    },
    processingStatus: {
      type: String,
      enum: ['uploaded', 'processing', 'processed', 'failed'],
      default: 'uploaded',
    },
    processingError: {
      type: String,
    },
    extractedText: {
      type: String,
    },
    pageCount: {
      type: Number,
    },
    wordCount: {
      type: Number,
    },
    characterCount: {
      type: Number,
    },
    checksum: {
      type: String,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
documentSchema.index({ knowledgeBase: 1 });
documentSchema.index({ uploadedBy: 1 });
documentSchema.index({ processingStatus: 1 });
documentSchema.index({ createdAt: -1 });
documentSchema.index({ checksum: 1 });

const Document = mongoose.model('Document', documentSchema);

export default Document;
