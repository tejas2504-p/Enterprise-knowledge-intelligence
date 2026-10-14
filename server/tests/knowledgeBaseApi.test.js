import { jest, describe, it, expect, afterEach } from '@jest/globals';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import {
  validateKBId,
  validateCreateKB,
  validateUpdateKB,
} from '../src/middleware/kbValidationMiddleware.js';
import { protect } from '../src/middleware/authMiddleware.js';
import {
  createKB,
  getKBs,
  getKB,
  updateKB,
  deleteKB,
} from '../src/controllers/kbController.js';
import KnowledgeBase from '../src/models/KnowledgeBase.js';
import Document from '../src/models/Document.js';
import User from '../src/models/User.js';

// Helper to mock express req, res, next
const mockRequestResponse = (overrides = {}) => {
  const req = {
    params: {},
    query: {},
    body: {},
    headers: {},
    cookies: {},
    user: null,
    ...overrides,
  };

  const res = {
    statusCode: 200,
    status: jest.fn().mockImplementation(function (code) {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn().mockImplementation(function (data) {
      res.body = data;
      return res;
    }),
    cookie: jest.fn(),
  };

  const next = jest.fn();

  return { req, res, next };
};

describe('Knowledge Base REST APIs & Middleware - Phase 2', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_here';
  const userId = new mongoose.Types.ObjectId();
  const otherUserId = new mongoose.Types.ObjectId();
  const kbId = new mongoose.Types.ObjectId();

  const standardUser = {
    _id: userId,
    name: 'Standard User',
    email: 'user@example.com',
    role: 'user',
    department: 'Engineering',
    isActive: true,
  };

  const adminUser = {
    _id: new mongoose.Types.ObjectId(),
    name: 'Admin User',
    email: 'admin@example.com',
    role: 'admin',
    department: 'IT',
    isActive: true,
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==========================================
  // 1. JWT AUTHENTICATION MIDDLEWARE
  // ==========================================
  describe('JWT Authentication Middleware', () => {
    it('should return 401 if no token is provided in header or cookie', async () => {
      const { req, res, next } = mockRequestResponse();

      await protect(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(next.mock.calls[0][0].message).toBe('Not authorized, no token');
    });

    it('should return 401 if token is invalid or expired', async () => {
      const { req, res, next } = mockRequestResponse({
        headers: { authorization: 'Bearer invalid-token-string' },
      });

      await protect(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(next.mock.calls[0][0].message).toBe('Not authorized, token failed');
    });

    it('should authenticate user via Bearer token in Authorization header', async () => {
      const validToken = jwt.sign({ userId: standardUser._id }, JWT_SECRET);
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockResolvedValue(standardUser),
      });

      const { req, res, next } = mockRequestResponse({
        headers: { authorization: `Bearer ${validToken}` },
      });

      await protect(req, res, next);

      expect(req.user).toEqual(standardUser);
      expect(next).toHaveBeenCalledWith();
    });

    it('should authenticate user via cookie', async () => {
      const validToken = jwt.sign({ userId: standardUser._id }, JWT_SECRET);
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockResolvedValue(standardUser),
      });

      const { req, res, next } = mockRequestResponse({
        cookies: { jwt: validToken },
      });

      await protect(req, res, next);

      expect(req.user).toEqual(standardUser);
      expect(next).toHaveBeenCalledWith();
    });

    it('should reject inactive user account with 401', async () => {
      const inactiveUser = { ...standardUser, isActive: false };
      const validToken = jwt.sign({ userId: inactiveUser._id }, JWT_SECRET);
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockResolvedValue(inactiveUser),
      });

      const { req, res, next } = mockRequestResponse({
        headers: { authorization: `Bearer ${validToken}` },
      });

      await protect(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(next.mock.calls[0][0].message).toMatch(/account is inactive/i);
    });
  });

  // ==========================================
  // 2. REQUEST VALIDATION MIDDLEWARE
  // ==========================================
  describe('Request Validation Middleware', () => {
    describe('validateKBId', () => {
      it('should return 400 for invalid MongoDB ObjectId in params', () => {
        const { req, res, next } = mockRequestResponse({
          params: { id: 'invalid-id-format' },
        });

        validateKBId(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          status: 'fail',
          message: 'Invalid Knowledge Base ID format',
        });
        expect(next).not.toHaveBeenCalled();
      });

      it('should proceed to next() if ID is a valid ObjectId', () => {
        const { req, res, next } = mockRequestResponse({
          params: { id: new mongoose.Types.ObjectId().toString() },
        });

        validateKBId(req, res, next);

        expect(next).toHaveBeenCalled();
      });
    });

    describe('validateCreateKB', () => {
      it('should reject missing name with 400', () => {
        const { req, res, next } = mockRequestResponse({
          body: { description: 'Missing name' },
        });

        validateCreateKB(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'fail',
            message: expect.stringMatching(/name/i),
          })
        );
      });

      it('should reject empty or whitespace name with 400', () => {
        const { req, res, next } = mockRequestResponse({
          body: { name: '   ' },
        });

        validateCreateKB(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'fail',
            message: expect.stringMatching(/name/i),
          })
        );
      });

      it('should reject name longer than 100 characters with 400', () => {
        const { req, res, next } = mockRequestResponse({
          body: { name: 'A'.repeat(101) },
        });

        validateCreateKB(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'fail',
            message: expect.stringMatching(/100 characters/i),
          })
        );
      });

      it('should reject description longer than 500 characters with 400', () => {
        const { req, res, next } = mockRequestResponse({
          body: { name: 'Valid Name', description: 'D'.repeat(501) },
        });

        validateCreateKB(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'fail',
            message: expect.stringMatching(/500 characters/i),
          })
        );
      });

      it('should reject invalid visibility value with 400', () => {
        const { req, res, next } = mockRequestResponse({
          body: { name: 'Valid Name', visibility: 'invalid_vis' },
        });

        validateCreateKB(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'fail',
            message: expect.stringMatching(/invalid visibility/i),
          })
        );
      });

      it('should reject invalid status value with 400', () => {
        const { req, res, next } = mockRequestResponse({
          body: { name: 'Valid Name', status: 'not_a_status' },
        });

        validateCreateKB(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'fail',
            message: expect.stringMatching(/invalid status/i),
          })
        );
      });

      it('should pass validation for valid create payload', () => {
        const { req, res, next } = mockRequestResponse({
          body: {
            name: 'Dev Knowledge Base',
            description: 'Engineering documentation',
            visibility: 'department',
            status: 'active',
          },
        });

        validateCreateKB(req, res, next);

        expect(next).toHaveBeenCalled();
      });
    });

    describe('validateUpdateKB', () => {
      it('should reject empty update body with 400', () => {
        const { req, res, next } = mockRequestResponse({ body: {} });

        validateUpdateKB(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'fail',
            message: expect.stringMatching(/provide fields to update/i),
          })
        );
      });

      it('should reject update if only unmodifiable fields are passed', () => {
        const { req, res, next } = mockRequestResponse({
          body: { owner: otherUserId.toString(), documentCount: 50 },
        });

        validateUpdateKB(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'fail',
            message: expect.stringMatching(/no modifiable fields/i),
          })
        );
      });

      it('should reject empty name on update with 400', () => {
        const { req, res, next } = mockRequestResponse({
          body: { name: '  ' },
        });

        validateUpdateKB(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'fail',
            message: expect.stringMatching(/name cannot be empty/i),
          })
        );
      });

      it('should reject invalid visibility on update with 400', () => {
        const { req, res, next } = mockRequestResponse({
          body: { visibility: 'all' },
        });

        validateUpdateKB(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'fail',
            message: expect.stringMatching(/invalid visibility/i),
          })
        );
      });
    });
  });

  // ==========================================
  // 3. CONTROLLER & PERMISSION LOGIC
  // ==========================================
  describe('POST /api/knowledge-bases (createKB)', () => {
    it('should create knowledge base and associate current user as owner', async () => {
      const createdKB = {
        _id: kbId,
        name: 'Product Manuals',
        description: 'User and dev manuals',
        owner: standardUser._id,
        department: 'Engineering',
        visibility: 'private',
        status: 'active',
        documentCount: 0,
        totalSize: 0,
        populate: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(KnowledgeBase, 'create').mockResolvedValue(createdKB);

      const { req, res, next } = mockRequestResponse({
        user: standardUser,
        body: {
          name: 'Product Manuals',
          description: 'User and dev manuals',
        },
      });

      await createKB(req, res, next);

      expect(KnowledgeBase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Product Manuals',
          owner: standardUser._id,
          department: standardUser.department,
          visibility: 'private',
          status: 'active',
        })
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        status: 'success',
        data: createdKB,
      });
    });
  });

  describe('GET /api/knowledge-bases (getKBs)', () => {
    it('should return 200 with list of accessible knowledge bases', async () => {
      const mockList = [
        { _id: kbId, name: 'Eng KB', visibility: 'private', owner: standardUser._id },
      ];

      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        populate: jest.fn().mockResolvedValue(mockList),
      };
      jest.spyOn(KnowledgeBase, 'find').mockReturnValue(mockQuery);

      const { req, res, next } = mockRequestResponse({
        user: standardUser,
      });

      await getKBs(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        status: 'success',
        count: 1,
        data: mockList,
      });
    });

    it('should allow filtering by status, visibility, and search term', async () => {
      const mockQuery = {
        sort: jest.fn().mockReturnThis(),
        populate: jest.fn().mockResolvedValue([]),
      };
      const findSpy = jest.spyOn(KnowledgeBase, 'find').mockReturnValue(mockQuery);

      const { req, res, next } = mockRequestResponse({
        user: adminUser,
        query: {
          status: 'active',
          visibility: 'organization',
          search: 'HR',
        },
      });

      await getKBs(req, res, next);

      expect(findSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'active',
          visibility: 'organization',
          $or: expect.arrayContaining([
            { name: expect.any(RegExp) },
            { description: expect.any(RegExp) },
          ]),
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('GET /api/knowledge-bases/:id (getKB)', () => {
    it('should return 400 if invalid ObjectId is supplied', async () => {
      const { req, res, next } = mockRequestResponse({
        user: standardUser,
        params: { id: 'invalid-id' },
      });

      await getKB(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        status: 'fail',
        message: 'Invalid Knowledge Base ID format',
      });
    });

    it('should return 404 if knowledge base is not found', async () => {
      jest.spyOn(KnowledgeBase, 'findById').mockReturnValue({
        populate: jest.fn().mockResolvedValue(null),
      });

      const { req, res, next } = mockRequestResponse({
        user: standardUser,
        params: { id: kbId.toString() },
      });

      await getKB(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        status: 'fail',
        message: 'Knowledge Base not found',
      });
    });

    it('should return 403 when standard user attempts to view another user private KB', async () => {
      const otherUserPrivateKB = {
        _id: kbId,
        name: 'Secret KB',
        owner: otherUserId,
        visibility: 'private',
      };

      jest.spyOn(KnowledgeBase, 'findById').mockReturnValue({
        populate: jest.fn().mockResolvedValue(otherUserPrivateKB),
      });

      const { req, res, next } = mockRequestResponse({
        user: standardUser,
        params: { id: kbId.toString() },
      });

      await getKB(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        status: 'fail',
        message: 'Not authorized to access this Knowledge Base',
      });
    });

    it('should allow user to view organization-wide KB', async () => {
      const orgKB = {
        _id: kbId,
        name: 'Public Handbook',
        owner: otherUserId,
        visibility: 'organization',
      };

      jest.spyOn(KnowledgeBase, 'findById').mockReturnValue({
        populate: jest.fn().mockResolvedValue(orgKB),
      });

      const { req, res, next } = mockRequestResponse({
        user: standardUser,
        params: { id: kbId.toString() },
      });

      await getKB(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        status: 'success',
        data: orgKB,
      });
    });

    it('should allow user to view department KB if in same department', async () => {
      const deptKB = {
        _id: kbId,
        name: 'Engineering Guide',
        owner: otherUserId,
        department: 'Engineering',
        visibility: 'department',
      };

      jest.spyOn(KnowledgeBase, 'findById').mockReturnValue({
        populate: jest.fn().mockResolvedValue(deptKB),
      });

      const { req, res, next } = mockRequestResponse({
        user: standardUser, // department: 'Engineering'
        params: { id: kbId.toString() },
      });

      await getKB(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        status: 'success',
        data: deptKB,
      });
    });

    it('should forbid user from viewing department KB if in different department', async () => {
      const salesDeptKB = {
        _id: kbId,
        name: 'Sales Guide',
        owner: otherUserId,
        department: 'Sales',
        visibility: 'department',
      };

      jest.spyOn(KnowledgeBase, 'findById').mockReturnValue({
        populate: jest.fn().mockResolvedValue(salesDeptKB),
      });

      const { req, res, next } = mockRequestResponse({
        user: standardUser, // department: 'Engineering'
        params: { id: kbId.toString() },
      });

      await getKB(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('PATCH /api/knowledge-bases/:id (updateKB)', () => {
    it('should return 404 if knowledge base does not exist', async () => {
      jest.spyOn(KnowledgeBase, 'findById').mockResolvedValue(null);

      const { req, res, next } = mockRequestResponse({
        user: standardUser,
        params: { id: kbId.toString() },
        body: { name: 'New Name' },
      });

      await updateKB(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        status: 'fail',
        message: 'Knowledge Base not found',
      });
    });

    it('should return 403 if non-owner non-admin tries to modify knowledge base', async () => {
      const existingKB = {
        _id: kbId,
        owner: otherUserId,
        name: 'Old Name',
      };

      jest.spyOn(KnowledgeBase, 'findById').mockResolvedValue(existingKB);

      const { req, res, next } = mockRequestResponse({
        user: standardUser,
        params: { id: kbId.toString() },
        body: { name: 'Attempted Hijack' },
      });

      await updateKB(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        status: 'fail',
        message: 'Not authorized to modify this Knowledge Base',
      });
    });

    it('should allow owner to update knowledge base', async () => {
      const existingKB = {
        _id: kbId,
        owner: standardUser._id,
        name: 'Old Name',
        description: 'Old Desc',
        visibility: 'private',
        status: 'active',
        save: jest.fn().mockResolvedValue(true),
        populate: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(KnowledgeBase, 'findById').mockResolvedValue(existingKB);

      const { req, res, next } = mockRequestResponse({
        user: standardUser,
        params: { id: kbId.toString() },
        body: {
          name: 'Updated Name',
          description: 'Updated Description',
          visibility: 'organization',
        },
      });

      await updateKB(req, res, next);

      expect(existingKB.name).toBe('Updated Name');
      expect(existingKB.description).toBe('Updated Description');
      expect(existingKB.visibility).toBe('organization');
      expect(existingKB.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        status: 'success',
        data: existingKB,
      });
    });

    it('should allow admin to update any knowledge base', async () => {
      const existingKB = {
        _id: kbId,
        owner: otherUserId,
        name: 'Old Name',
        save: jest.fn().mockResolvedValue(true),
        populate: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(KnowledgeBase, 'findById').mockResolvedValue(existingKB);

      const { req, res, next } = mockRequestResponse({
        user: adminUser,
        params: { id: kbId.toString() },
        body: { status: 'archived' },
      });

      await updateKB(req, res, next);

      expect(existingKB.status).toBe('archived');
      expect(existingKB.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('DELETE /api/knowledge-bases/:id (deleteKB)', () => {
    it('should return 404 if knowledge base does not exist', async () => {
      jest.spyOn(KnowledgeBase, 'findById').mockResolvedValue(null);

      const { req, res, next } = mockRequestResponse({
        user: standardUser,
        params: { id: kbId.toString() },
      });

      await deleteKB(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        status: 'fail',
        message: 'Knowledge Base not found',
      });
    });

    it('should return 403 if non-owner non-admin tries to delete knowledge base', async () => {
      const existingKB = {
        _id: kbId,
        owner: otherUserId,
      };

      jest.spyOn(KnowledgeBase, 'findById').mockResolvedValue(existingKB);

      const { req, res, next } = mockRequestResponse({
        user: standardUser,
        params: { id: kbId.toString() },
      });

      await deleteKB(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        status: 'fail',
        message: 'Not authorized to delete this Knowledge Base',
      });
    });

    it('should allow owner to delete knowledge base and delete related documents', async () => {
      const existingKB = {
        _id: kbId,
        owner: standardUser._id,
        deleteOne: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(KnowledgeBase, 'findById').mockResolvedValue(existingKB);
      jest.spyOn(Document, 'deleteMany').mockResolvedValue({ deletedCount: 3 });

      const { req, res, next } = mockRequestResponse({
        user: standardUser,
        params: { id: kbId.toString() },
      });

      await deleteKB(req, res, next);

      expect(Document.deleteMany).toHaveBeenCalledWith({ knowledgeBase: kbId });
      expect(existingKB.deleteOne).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        status: 'success',
        message: 'Knowledge Base deleted successfully',
      });
    });

    it('should allow admin to delete knowledge base', async () => {
      const existingKB = {
        _id: kbId,
        owner: otherUserId,
        deleteOne: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(KnowledgeBase, 'findById').mockResolvedValue(existingKB);
      jest.spyOn(Document, 'deleteMany').mockResolvedValue({ deletedCount: 0 });

      const { req, res, next } = mockRequestResponse({
        user: adminUser,
        params: { id: kbId.toString() },
      });

      await deleteKB(req, res, next);

      expect(existingKB.deleteOne).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
