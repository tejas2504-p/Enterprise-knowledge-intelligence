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
  },
  {
    timestamps: true,
  }
);

const KnowledgeBase = mongoose.model('KnowledgeBase', knowledgeBaseSchema);

export default KnowledgeBase;
