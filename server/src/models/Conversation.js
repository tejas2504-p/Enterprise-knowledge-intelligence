import mongoose from 'mongoose';

const citationSchema = new mongoose.Schema(
  {
    document_id: { type: String, required: true },
    filename: { type: String, default: null },
    title: { type: String, default: null },
    fileType: { type: String, default: null },
    chunk_id: { type: String, default: null },
    page_number: { type: Number, default: null },
    excerpt: { type: String, required: true },
    score: { type: Number, required: true },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    citations: {
      type: [citationSchema],
      default: [],
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    insufficientEvidence: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const conversationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    knowledgeBase: {
      type: mongoose.Schema.ObjectId,
      ref: 'KnowledgeBase',
      required: true,
      index: true,
    },
    knowledgeBaseName: {
      type: String,
      default: '',
    },
    title: {
      type: String,
      trim: true,
      maxlength: 150,
      default: 'New Conversation',
    },
    messages: {
      type: [messageSchema],
      default: [],
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

conversationSchema.index({ user: 1, lastMessageAt: -1 });
conversationSchema.index({ user: 1, knowledgeBase: 1, lastMessageAt: -1 });

const Conversation = mongoose.model('Conversation', conversationSchema);

export default Conversation;
