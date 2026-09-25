import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * User Model
 * 
 * Future Database Architecture Considerations:
 * - Organizations/Departments: We will use a relational mapping for `department` via ObjectId. 
 *   The `Department` model will likely hold a reference to an `Organization` model. This allows for scalable multi-tenant architectures.
 * - Documents & Knowledge Bases: Users will be linked to Documents through future ACLs (Access Control Lists) or Roles,
 *   likely using an intermediate `DocumentPermission` collection mapping User <-> Document.
 * - Conversations & Messages: `Conversation` and `Message` models will store a `user: ObjectId` reference to identify the author.
 * - RAG metadata: Vector embeddings and contextual metadata will live in separate collections linked to Documents/KnowledgeBases,
 *   while user-specific query history or preferences will tie back to this User model.
 */

const userSchema = new mongoose.Schema(
  {
    // The user's full display name for UI presentation and communication
    name: {
      type: String,
      required: [true, 'Please provide a name'],
      trim: true,
      maxlength: [50, 'Name cannot be more than 50 characters'],
    },
    // The user's login credential and primary contact method. Must be unique across the platform.
    email: {
      type: String,
      required: [true, 'Please provide an email address'],
      unique: true,
      lowercase: true, // Normalizes email to avoid case-sensitivity issues
      trim: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        'Please provide a valid email address',
      ],
      index: true, // Index speeds up authentication queries
    },
    // The user's secure access credential. Will be hashed before saving.
    password: {
      type: String,
      required: [true, 'Please provide a password'],
      minlength: [8, 'Password must be at least 8 characters long'],
      select: false, // Prevents password hashes from accidentally leaking in standard queries
    },
    // Defines base permissions within the platform (e.g., standard user vs system admin).
    // Future granular permissions will be handled by a separate DocumentPermission or RBAC system.
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    // Logical grouping for users within an Organization.
    department: {
      type: String,
      default: null,
      index: true, // Speeds up queries fetching all users in a department
    },
    // Visual identifier for the user in the UI (e.g., chat interface, team lists)
    avatar: {
      type: String,
      default: 'default-avatar.png', 
    },
    // Soft-delete and access control flag. False revokes platform access without deleting historical relational data.
    isActive: {
      type: Boolean,
      default: true,
      index: true, // Frequently filtered upon to exclude deactivated users
    },
    // Audit trail for security and usage tracking purposes
    lastLogin: {
      type: Date,
      default: null,
    },
  },
  {
    // Automatically manages 'createdAt' and 'updatedAt' fields, critical for auditing and caching strategies
    timestamps: true, 
  }
);

// Pre-save hook: Handles password hashing automatically whenever the password is changed or created
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Instance method: Securely compares a plaintext password attempt with the stored hash
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model('User', userSchema);

export default User;
