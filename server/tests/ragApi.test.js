import { jest, describe, it, expect, beforeAll, afterEach } from '@jest/globals';
import mongoose from 'mongoose';
import crypto from 'crypto';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

import KnowledgeBase from '../src/models/KnowledgeBase.js';
import Document from '../src/models/Document.js';
import Conversation from '../src/models/Conversation.js';
import User from '../src/models/User.js';
import routes from '../src/routes/index.js';
import { notFound, errorHandler } from '../src/middleware/errorMiddleware.js';
import { createUserContextToken, ragClient } from '../src/services/aiServiceClient.js';
import { canUserReadDocument, canUserViewKB } from '../src/utils/accessControl.js';

// Build lightweight Express test app using real middleware & routes (without triggering Atlas connectDB hang)
const buildTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', routes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
};

describe('Node.js RAG Gateway, RBAC & Conversation History APIs', () => {
  const app = buildTestApp();
  const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_here';

  const ownerId = new mongoose.Types.ObjectId();
  const engUserId = new mongoose.Types.ObjectId();
  const salesUserId = new mongoose.Types.ObjectId();
  const adminUserId = new mongoose.Types.ObjectId();

  const kbId = new mongoose.Types.ObjectId();
  const convId = new mongoose.Types.ObjectId();
  const publicDocId = new mongoose.Types.ObjectId();
  const restrictedDocId = new mongoose.Types.ObjectId();

  const ownerUser = {
    _id: ownerId,
    name: 'Alice Owner',
    email: 'alice@example.com',
    role: 'user',
    department: 'Engineering',
    organization: 'org_acme',
    isActive: true,
  };

  const engUser = {
    _id: engUserId,
    name: 'Bob Engineer',
    email: 'bob@example.com',
    role: 'user',
    department: 'Engineering',
    organization: 'org_acme',
    isActive: true,
  };

  const salesUser = {
    _id: salesUserId,
    name: 'Carol Sales',
    email: 'carol@example.com',
    role: 'user',
    department: 'Sales',
    organization: 'org_acme',
    isActive: true,
  };

  const adminUser = {
    _id: adminUserId,
    name: 'Admin',
    email: 'admin@example.com',
    role: 'admin',
    department: 'IT',
    organization: 'org_acme',
    isActive: true,
  };

  const signJwt = (userId) => jwt.sign({ userId }, JWT_SECRET);

  const mockAuthUser = (userObj) => {
    jest.spyOn(User, 'findById').mockReturnValue({
      select: jest.fn().mockResolvedValue(userObj),
    });
  };

  beforeAll(() => {
    process.env.SERVICE_API_KEY = process.env.SERVICE_API_KEY || 'test_internal_secret_key';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==========================================================
  // 1. TRUSTED SERVER-SIDE IDENTITY & AUTHENTICATION
  // ==========================================================
  describe('Authentication & Server-Signed User Context', () => {
    it('should reject unauthenticated requests to POST /api/rag/query with 401', async () => {
      const res = await request(app)
        .post('/api/rag/query')
        .send({ question: 'What is the policy?', knowledgeBaseId: kbId.toString() });

      expect(res.statusCode).toBe(401);
    });

    it('should reject unauthenticated requests to GET /api/conversations with 401', async () => {
      const res = await request(app).get('/api/conversations');
      expect(res.statusCode).toBe(401);
    });

    it('should cryptographically sign verified user context with HMAC-SHA256 matching Python verification', () => {
      const token = createUserContextToken(engUser, 'org_acme');
      const [encodedPayload, sig] = token.split('.');
      expect(encodedPayload).toBeTruthy();
      expect(sig).toBeTruthy();

      const expectedSig = crypto
        .createHmac('sha256', process.env.SERVICE_API_KEY)
        .update(encodedPayload, 'utf8')
        .digest('base64url');
      expect(sig).toBe(expectedSig);

      const decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
      expect(decoded.user_id).toBe(engUserId.toString());
      expect(decoded.role).toBe('user');
      expect(decoded.department).toBe('Engineering');
      expect(decoded.organization_id).toBe('org_acme');
    });

    it('should ignore spoofed client identity fields/headers and forward ONLY JWT-verified user context', async () => {
      mockAuthUser(engUser);
      const token = signJwt(engUserId);

      jest.spyOn(KnowledgeBase, 'findById').mockResolvedValue({
        _id: kbId,
        name: 'Engineering KB',
        owner: ownerId,
        visibility: 'organization',
        organization: 'org_acme',
        status: 'active',
      });

      jest.spyOn(Document, 'find').mockResolvedValue([
        {
          _id: publicDocId,
          title: 'Arch Spec',
          originalFileName: 'arch.pdf',
          uploadedBy: ownerId,
          visibility: 'public',
          indexingStatus: 'indexed',
        },
      ]);

      const postSpy = jest.spyOn(ragClient, 'post').mockResolvedValue({
        data: {
          answer: 'Use TLS 1.3 [Evidence 1].',
          citations: [
            {
              document_id: publicDocId.toString(),
              filename: 'arch.pdf',
              chunk_id: 'chunk_0',
              page_number: 1,
              excerpt: 'All services must enforce TLS 1.3.',
              score: 0.91,
            },
          ],
          metadata: {
            knowledge_base_id: kbId.toString(),
            chunks_retrieved: 1,
            chunks_used: 1,
            model: 'gemini-2.5-flash',
            similarity_threshold: 0.65,
            insufficient_evidence: false,
          },
          conversationId: null,
        },
      });

      jest.spyOn(Conversation, 'create').mockResolvedValue({
        _id: convId,
      });

      // Attacker attempts to spoof role='admin' and userId=ownerId in request body & headers
      const res = await request(app)
        .post('/api/rag/query')
        .set('Authorization', `Bearer ${token}`)
        .set('x-user-id', ownerId.toString())
        .set('x-user-role', 'admin')
        .send({
          question: 'What TLS version is required?',
          knowledgeBaseId: kbId.toString(),
          userId: ownerId.toString(),
          role: 'admin',
        });

      expect(res.statusCode).toBe(200);
      expect(postSpy).toHaveBeenCalledTimes(1);

      const [, sentPayload, sentConfig] = postSpy.mock.calls[0];
      expect(sentPayload).not.toHaveProperty('userId');
      expect(sentPayload).not.toHaveProperty('role');
      expect(sentConfig.headers['x-api-key']).toBe(process.env.SERVICE_API_KEY);

      // Verify signed token contains Bob Engineer's actual JWT user ID & 'user' role, NOT spoofed admin/owner!
      const signedToken = sentConfig.headers['x-user-context-token'];
      const [payloadB64] = signedToken.split('.');
      const verifiedClaims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
      expect(verifiedClaims.user_id).toBe(engUserId.toString());
      expect(verifiedClaims.role).toBe('user');
      expect(verifiedClaims.department).toBe('Engineering');
    });
  });

  // ==========================================================
  // 2. ACCESS-DENIED & AUTHORIZATION BOUNDARIES BEFORE RETRIEVAL
  // ==========================================================
  describe('Pre-Retrieval Knowledge Base & Document Authorization', () => {
    it('should return 403 before retrieval when querying another user private KB', async () => {
      mockAuthUser(engUser);
      const token = signJwt(engUserId);

      jest.spyOn(KnowledgeBase, 'findById').mockResolvedValue({
        _id: kbId,
        name: 'Private Executive KB',
        owner: ownerId,
        visibility: 'private',
        organization: 'org_acme',
        status: 'active',
      });

      const aiSpy = jest.spyOn(ragClient, 'post');

      const res = await request(app)
        .post('/api/rag/query')
        .set('Authorization', `Bearer ${token}`)
        .send({
          question: 'What are executive bonuses?',
          knowledgeBaseId: kbId.toString(),
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/Not authorized to access this Knowledge Base/i);
      expect(aiSpy).not.toHaveBeenCalled();
    });

    it('should return 403 before retrieval when user from wrong department queries department KB', async () => {
      mockAuthUser(salesUser); // Department: Sales
      const token = signJwt(salesUserId);

      jest.spyOn(KnowledgeBase, 'findById').mockResolvedValue({
        _id: kbId,
        name: 'Engineering Only KB',
        owner: ownerId,
        visibility: 'department',
        department: 'Engineering',
        organization: 'org_acme',
        status: 'active',
      });

      const aiSpy = jest.spyOn(ragClient, 'post');

      const res = await request(app)
        .post('/api/rag/query')
        .set('Authorization', `Bearer ${token}`)
        .send({
          question: 'What is our CI/CD architecture?',
          knowledgeBaseId: kbId.toString(),
        });

      expect(res.statusCode).toBe(403);
      expect(aiSpy).not.toHaveBeenCalled();
    });

    it('should return 403 when querying an archived Knowledge Base', async () => {
      mockAuthUser(ownerUser);
      const token = signJwt(ownerId);

      jest.spyOn(KnowledgeBase, 'findById').mockResolvedValue({
        _id: kbId,
        name: 'Old Archive',
        owner: ownerId,
        visibility: 'private',
        status: 'archived',
      });

      const aiSpy = jest.spyOn(ragClient, 'post');

      const res = await request(app)
        .post('/api/rag/query')
        .set('Authorization', `Bearer ${token}`)
        .send({
          question: 'Search archive',
          knowledgeBaseId: kbId.toString(),
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/archived/i);
      expect(aiSpy).not.toHaveBeenCalled();
    });

    it('should filter out citations from restricted documents the user is not authorized to read', async () => {
      mockAuthUser(engUser);
      const token = signJwt(engUserId);

      const orgKb = {
        _id: kbId,
        name: 'Company KB',
        owner: ownerId,
        visibility: 'organization',
        organization: 'org_acme',
        status: 'active',
      };
      jest.spyOn(KnowledgeBase, 'findById').mockResolvedValue(orgKb);

      const docsInKb = [
        {
          _id: publicDocId,
          title: 'Public Policy',
          originalFileName: 'public.pdf',
          uploadedBy: ownerId,
          visibility: 'public',
          indexingStatus: 'indexed',
        },
        {
          _id: restrictedDocId,
          title: 'Restricted Salary Sheet',
          originalFileName: 'salaries.pdf',
          uploadedBy: ownerId,
          visibility: 'restricted',
          indexingStatus: 'indexed',
        },
      ];
      jest.spyOn(Document, 'find').mockResolvedValue(docsInKb);

      // Verify helper rules directly
      expect(canUserViewKB(engUser, orgKb)).toBe(true);
      expect(canUserReadDocument(engUser, docsInKb[0], orgKb)).toBe(true);
      expect(canUserReadDocument(engUser, docsInKb[1], orgKb)).toBe(false);
      expect(canUserReadDocument(adminUser, docsInKb[1], orgKb)).toBe(true);

      // Simulate Python returning both citations (defense-in-depth verification in Node)
      jest.spyOn(ragClient, 'post').mockResolvedValue({
        data: {
          answer: 'Based on available documents.',
          citations: [
            {
              document_id: publicDocId.toString(),
              filename: 'public.pdf',
              chunk_id: 'c1',
              page_number: 1,
              excerpt: 'Standard public hours are 9-5.',
              score: 0.85,
            },
            {
              document_id: restrictedDocId.toString(),
              filename: 'salaries.pdf',
              chunk_id: 'c2',
              page_number: 2,
              excerpt: 'Confidential payroll info.',
              score: 0.82,
            },
          ],
          metadata: {
            knowledge_base_id: kbId.toString(),
            chunks_retrieved: 2,
            chunks_used: 2,
            model: 'gemini-2.5-flash',
            similarity_threshold: 0.65,
            insufficient_evidence: false,
          },
        },
      });

      jest.spyOn(Conversation, 'create').mockResolvedValue({ _id: convId });

      const res = await request(app)
        .post('/api/rag/query')
        .set('Authorization', `Bearer ${token}`)
        .send({
          question: 'What are working hours?',
          knowledgeBaseId: kbId.toString(),
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.citations).toHaveLength(1);
      expect(res.body.data.citations[0].document_id).toBe(publicDocId.toString());
      expect(res.body.data.citations[0].title).toBe('Public Policy');
    });

    it('should forbid accessing or continuing another user conversation with 403', async () => {
      mockAuthUser(salesUser);
      const token = signJwt(salesUserId);

      jest.spyOn(KnowledgeBase, 'findById').mockResolvedValue({
        _id: kbId,
        name: 'Company KB',
        owner: ownerId,
        visibility: 'organization',
        status: 'active',
      });

      jest.spyOn(Conversation, 'findById').mockResolvedValue({
        _id: convId,
        user: engUserId, // Owned by Bob, NOT Carol!
        knowledgeBase: kbId,
        messages: [],
      });

      const aiSpy = jest.spyOn(ragClient, 'post');

      // Attempt to inject into Bob's conversation
      const queryRes = await request(app)
        .post('/api/rag/query')
        .set('Authorization', `Bearer ${token}`)
        .send({
          question: 'Hijack conversation?',
          knowledgeBaseId: kbId.toString(),
          conversationId: convId.toString(),
        });

      expect(queryRes.statusCode).toBe(403);
      expect(aiSpy).not.toHaveBeenCalled();

      // Attempt to read Bob's conversation history
      const getRes = await request(app)
        .get(`/api/conversations/${convId.toString()}`)
        .set('Authorization', `Bearer ${token}`);

      expect(getRes.statusCode).toBe(403);

      // Attempt to delete Bob's conversation
      const delRes = await request(app)
        .delete(`/api/conversations/${convId.toString()}`)
        .set('Authorization', `Bearer ${token}`);

      expect(delRes.statusCode).toBe(403);
    });
  });

  // ==========================================================
  // 3. REAL STRUCTURED RESPONSES, UNINDEXED KB, CONVERSATIONS & ERRORS
  // ==========================================================
  describe('Structured Answers, No-Indexed Metadata & Safe Error Handling', () => {
    it('should handle insufficient-evidence and unindexed document metadata cleanly', async () => {
      mockAuthUser(ownerUser);
      const token = signJwt(ownerId);

      jest.spyOn(KnowledgeBase, 'findById').mockResolvedValue({
        _id: kbId,
        name: 'Empty KB',
        owner: ownerId,
        visibility: 'private',
        status: 'active',
      });
      jest.spyOn(Document, 'find').mockResolvedValue([]);

      jest.spyOn(ragClient, 'post').mockResolvedValue({
        data: {
          answer: 'I do not have sufficient evidence in the provided documents to answer this question.',
          citations: [],
          metadata: {
            knowledge_base_id: kbId.toString(),
            chunks_retrieved: 0,
            chunks_used: 0,
            model: 'gemini-2.5-flash',
            similarity_threshold: 0.65,
            insufficient_evidence: true,
            no_indexed_documents: true,
          },
        },
      });

      jest.spyOn(Conversation, 'create').mockResolvedValue({ _id: convId });

      const res = await request(app)
        .post('/api/rag/query')
        .set('Authorization', `Bearer ${token}`)
        .send({
          question: 'What is in this KB?',
          knowledgeBaseId: kbId.toString(),
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.metadata.insufficient_evidence).toBe(true);
      expect(res.body.data.metadata.no_indexed_documents).toBe(true);
      expect(res.body.data.metadata.indexed_documents).toBe(0);
      expect(res.body.data.citations).toEqual([]);
      expect(res.body.data.conversationId).toBe(convId.toString());
    });

    it('should list authenticated user conversations without exposing other users data', async () => {
      mockAuthUser(engUser);
      const token = signJwt(engUserId);

      const convDocs = [
        {
          _id: convId,
          title: 'TLS Policy Question',
          knowledgeBase: kbId,
          knowledgeBaseName: 'Engineering KB',
          messages: [
            { role: 'user', content: 'What TLS version?' },
            { role: 'assistant', content: 'Use TLS 1.3.' },
          ],
          lastMessageAt: new Date('2026-11-25T10:00:00Z'),
          createdAt: new Date('2026-11-25T10:00:00Z'),
        },
      ];

      const mockChain = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue(convDocs),
      };
      const findSpy = jest.spyOn(Conversation, 'find').mockReturnValue(mockChain);

      const res = await request(app)
        .get('/api/conversations')
        .set('Authorization', `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(findSpy).toHaveBeenCalledWith({ user: engUserId });
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe('TLS Policy Question');
      expect(res.body.data[0].messageCount).toBe(2);
    });

    it('should sanitize AI service errors and never leak service keys', async () => {
      mockAuthUser(ownerUser);
      const token = signJwt(ownerId);

      jest.spyOn(KnowledgeBase, 'findById').mockResolvedValue({
        _id: kbId,
        name: 'Private KB',
        owner: ownerId,
        visibility: 'private',
        status: 'active',
      });
      jest.spyOn(Document, 'find').mockResolvedValue([]);

      const leakedSecretErr = new Error('Connection failed with AIzaSySuperSecretKey1234567890');
      leakedSecretErr.response = {
        status: 500,
        data: { detail: 'Internal error involving AIzaSySuperSecretKey1234567890' },
      };
      jest.spyOn(ragClient, 'post').mockRejectedValue(leakedSecretErr);

      const res = await request(app)
        .post('/api/rag/query')
        .set('Authorization', `Bearer ${token}`)
        .send({
          question: 'Test error sanitization',
          knowledgeBaseId: kbId.toString(),
        });

      expect(res.statusCode).toBe(502);
      expect(res.body.message).not.toContain('AIzaSySuperSecretKey');
      expect(res.body.message).toContain('[REDACTED_KEY]');
    });

    it('should forbid reading a restricted document directly via GET /api/documents/:id', async () => {
      mockAuthUser(engUser);
      const token = signJwt(engUserId);

      jest.spyOn(Document, 'findById').mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          _id: restrictedDocId,
          title: 'Restricted Salary Sheet',
          knowledgeBase: kbId,
          uploadedBy: ownerId,
          visibility: 'restricted',
        }),
      });

      jest.spyOn(KnowledgeBase, 'findById').mockResolvedValue({
        _id: kbId,
        name: 'Company KB',
        owner: ownerId,
        visibility: 'organization',
        status: 'active',
      });

      const res = await request(app)
        .get(`/api/documents/${restrictedDocId.toString()}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toMatch(/Not authorized/i);
    });
  });
});
