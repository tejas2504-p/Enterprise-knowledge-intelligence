import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Please provide a document title'],
      trim: true,
    },
    originalName: {
      type: String,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    size: {
      type: Number,
      required: true,
    },
    knowledgeBaseId: {
      type: mongoose.Schema.ObjectId,
      ref: 'KnowledgeBase',
      required: true,
    },
    uploadedBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
    },
    filePath: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const Document = mongoose.model('Document', documentSchema);

export default Document;
