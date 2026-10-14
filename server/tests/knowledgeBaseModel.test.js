import mongoose from 'mongoose';
import KnowledgeBase from '../src/models/KnowledgeBase.js';
import User from '../src/models/User.js';
import Document from '../src/models/Document.js';

describe('KnowledgeBase Mongoose Model - Phase 2', () => {
  const validOwnerId = new mongoose.Types.ObjectId();

  const getValidationError = async (doc) => {
    try {
      await doc.validate();
      return null;
    } catch (err) {
      return err;
    }
  };

  describe('Field Schema & Defaults', () => {
    it('should have all required fields defined in schema', () => {
      const paths = KnowledgeBase.schema.paths;
      expect(paths.name).toBeDefined();
      expect(paths.description).toBeDefined();
      expect(paths.owner).toBeDefined();
      expect(paths.organization).toBeDefined();
      expect(paths.department).toBeDefined();
      expect(paths.visibility).toBeDefined();
      expect(paths.status).toBeDefined();
      expect(paths.documentCount).toBeDefined();
      expect(paths.totalSize).toBeDefined();
      expect(paths.createdAt).toBeDefined();
      expect(paths.updatedAt).toBeDefined();
    });

    it('should apply correct default values', () => {
      const kb = new KnowledgeBase({
        name: 'Default Test KB',
        owner: validOwnerId,
      });

      expect(kb.visibility).toBe('private');
      expect(kb.status).toBe('active');
      expect(kb.documentCount).toBe(0);
      expect(kb.totalSize).toBe(0);
      expect(kb.description).toBe('');
      expect(kb.organization).toBeNull();
      expect(kb.department).toBeNull();
    });

    it('should validate a complete, valid knowledge base successfully', async () => {
      const kb = new KnowledgeBase({
        name: 'Enterprise Policies',
        description: 'Company-wide operating policies and handbooks.',
        owner: validOwnerId,
        organization: 'Acme Corp',
        department: 'Human Resources',
        visibility: 'organization',
        status: 'active',
        documentCount: 5,
        totalSize: 1048576,
      });

      const validationError = await getValidationError(kb);
      expect(validationError).toBeNull();
    });
  });

  describe('Validation Rules', () => {
    it('should fail validation if name is missing', async () => {
      const kb = new KnowledgeBase({
        owner: validOwnerId,
      });

      const err = await getValidationError(kb);
      expect(err).toBeDefined();
      expect(err.errors.name).toBeDefined();
      expect(err.errors.name.message).toMatch(/provide a knowledge base name/i);
    });

    it('should fail validation if name exceeds 100 characters', async () => {
      const longName = 'A'.repeat(101);
      const kb = new KnowledgeBase({
        name: longName,
        owner: validOwnerId,
      });

      const err = await getValidationError(kb);
      expect(err).toBeDefined();
      expect(err.errors.name).toBeDefined();
      expect(err.errors.name.message).toMatch(/cannot be more than 100 characters/i);
    });

    it('should fail validation if description exceeds 500 characters', async () => {
      const longDescription = 'D'.repeat(501);
      const kb = new KnowledgeBase({
        name: 'Valid Name',
        description: longDescription,
        owner: validOwnerId,
      });

      const err = await getValidationError(kb);
      expect(err).toBeDefined();
      expect(err.errors.description).toBeDefined();
      expect(err.errors.description.message).toMatch(/cannot be more than 500 characters/i);
    });

    it('should fail validation if owner is missing', async () => {
      const kb = new KnowledgeBase({
        name: 'Ownerless KB',
      });

      const err = await getValidationError(kb);
      expect(err).toBeDefined();
      expect(err.errors.owner).toBeDefined();
    });

    it('should support valid visibility values: private, department, organization', async () => {
      for (const vis of ['private', 'department', 'organization']) {
        const kb = new KnowledgeBase({
          name: `${vis} KB`,
          owner: validOwnerId,
          visibility: vis,
        });
        const err = await getValidationError(kb);
        expect(err).toBeNull();
        expect(kb.visibility).toBe(vis);
      }
    });

    it('should fail validation on invalid visibility value', async () => {
      const kb = new KnowledgeBase({
        name: 'Invalid Visibility KB',
        owner: validOwnerId,
        visibility: 'public_to_all',
      });

      const err = await getValidationError(kb);
      expect(err).toBeDefined();
      expect(err.errors.visibility).toBeDefined();
    });

    it('should support valid status values: active, archived', async () => {
      for (const st of ['active', 'archived']) {
        const kb = new KnowledgeBase({
          name: `${st} KB`,
          owner: validOwnerId,
          status: st,
        });
        const err = await getValidationError(kb);
        expect(err).toBeNull();
        expect(kb.status).toBe(st);
      }
    });

    it('should fail validation on invalid status value', async () => {
      const kb = new KnowledgeBase({
        name: 'Invalid Status KB',
        owner: validOwnerId,
        status: 'deleted',
      });

      const err = await getValidationError(kb);
      expect(err).toBeDefined();
      expect(err.errors.status).toBeDefined();
    });

    it('should fail validation if documentCount is negative', async () => {
      const kb = new KnowledgeBase({
        name: 'Negative Doc Count',
        owner: validOwnerId,
        documentCount: -1,
      });

      const err = await getValidationError(kb);
      expect(err).toBeDefined();
      expect(err.errors.documentCount).toBeDefined();
    });

    it('should fail validation if totalSize is negative', async () => {
      const kb = new KnowledgeBase({
        name: 'Negative Size',
        owner: validOwnerId,
        totalSize: -50,
      });

      const err = await getValidationError(kb);
      expect(err).toBeDefined();
      expect(err.errors.totalSize).toBeDefined();
    });

    it('should trim string fields', () => {
      const kb = new KnowledgeBase({
        name: '   Trimmed KB Name   ',
        description: '   Trimmed Description   ',
        organization: '   Acme Corp   ',
        department: '   Engineering   ',
        owner: validOwnerId,
      });

      expect(kb.name).toBe('Trimmed KB Name');
      expect(kb.description).toBe('Trimmed Description');
      expect(kb.organization).toBe('Acme Corp');
      expect(kb.department).toBe('Engineering');
    });
  });

  describe('Indexes', () => {
    it('should define indexes on owner, department, organization, and createdAt', () => {
      const indexes = KnowledgeBase.schema.indexes();

      const hasOwnerIndex = indexes.some(([fields]) => fields.owner !== undefined);
      const hasDepartmentIndex = indexes.some(([fields]) => fields.department !== undefined);
      const hasOrganizationIndex = indexes.some(([fields]) => fields.organization !== undefined);
      const hasCreatedAtIndex = indexes.some(([fields]) => fields.createdAt !== undefined);

      expect(hasOwnerIndex).toBe(true);
      expect(hasDepartmentIndex).toBe(true);
      expect(hasOrganizationIndex).toBe(true);
      expect(hasCreatedAtIndex).toBe(true);
    });
  });

  describe('Relationships', () => {
    it('should reference the User model on the owner field', () => {
      const ownerPath = KnowledgeBase.schema.path('owner');
      expect(ownerPath.options.ref).toBe('User');
      expect(ownerPath.instance).toBe('ObjectId');
    });

    it('should define a virtual populate for documents referencing Document model', () => {
      const virtualDocuments = KnowledgeBase.schema.virtuals.documents;
      expect(virtualDocuments).toBeDefined();
      expect(virtualDocuments.options.ref).toBe('Document');
      expect(virtualDocuments.options.foreignField).toBe('knowledgeBase');
      expect(virtualDocuments.options.localField).toBe('_id');
    });

    it('should have toJSON and toObject virtuals enabled', () => {
      expect(KnowledgeBase.schema.options.toJSON.virtuals).toBe(true);
      expect(KnowledgeBase.schema.options.toObject.virtuals).toBe(true);
    });
  });
});
