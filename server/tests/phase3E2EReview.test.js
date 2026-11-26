import { jest, describe, it, expect, beforeAll, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

import User from '../src/models/User.js';
import KnowledgeBase from '../src/models/KnowledgeBase.js';
import Document from '../src/models/Document.js';
import Conversation from '../src/models/Conversation.js';
import routes from '../src/routes/index.js';
import { notFound, errorHandler } from '../src/middleware/errorMiddleware.js';
import { documentProcessingService } from '../src/services/documentProcessingService.js';
import { aiClient, ragClient } from '../src/services/aiServiceClient.js';

const buildTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', routes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
};

describe('Phase 3 End-to-End Node.js Security, Error Hygiene & Flow Review', () => {
  const app = buildTestApp();
  const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_here';

  const ownerId = new mongoose.Types.ObjectId();
  const orgAlphaKbId = new mongoose.Types.ObjectId();
  const docId = new mongoose.Types.ObjectId();
  const convId = new mongoose.Types.ObjectId();

  const alphaUser = {
    _id: ownerId,
    name: 'Alice Alpha',
    email: 'alice@alpha.com',
    role: 'user',
    department: 'Engineering',
    organization: 'org_alpha',
    isActive: true,
  };

  const betaUser = {
    _id: new mongoose.Types.ObjectId(),
    name: 'Bob Beta',
    email: 'bob@beta.com',
    role: 'user',
    department: 'Engineering',
    organization: 'org_beta',
    isActive: true,
  };

  const signJwt = (userId) => jwt.sign({ userId }, JWT_SECRET);

  beforeAll(() => {
    process.env.SERVICE_API_KEY = process.env.SERVICE_API_KEY || 'review_internal_secret_key';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('completes full Phase 2 extraction -> Phase 3 AI indexing -> RAG query -> citation grounding flow', async () => {
    // Prepare a real temporary uploaded text file in uploads/
    const uploadsDir = path.join(process.cwd(), 'uploads');
    await fs.mkdir(uploadsDir, { recursive: true });
    const tempFilename = `phase3_review_${Date.now()}.txt`;
    const tempFilePath = path.join(uploadsDir, tempFilename);
    await fs.writeFile(
      tempFilePath,
      'Enterprise Incident SLA: Critical P1 security incidents must be escalated within 15 minutes.',
      'utf-8'
    );

    try {
      const mockDocRecord = {
        _id: docId,
        title: 'Incident Response SLA',
        originalFileName: tempFilename,
        mimeType: 'text/plain',
        fileSize: 88,
        storageKey: tempFilename,
        knowledgeBase: {
          _id: orgAlphaKbId,
          name: 'Security KB',
          organization: 'org_alpha',
          department: 'Engineering',
        },
        uploadedBy: ownerId,
        visibility: 'public',
        processingStatus: 'uploaded',
        indexingStatus: 'pending',
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(Document, 'findById').mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockDocRecord),
      });

      const aiIndexSpy = jest.spyOn(aiClient, 'post').mockResolvedValue({
        data: { status: 'success', document_id: docId.toString(), chunks_indexed: 1 },
      });

      // Step A: Phase 2 Extraction -> Phase 3 Vector Indexing trigger
      const processed = await documentProcessingService.processDocument(docId.toString());
      expect(processed.processingStatus).toBe('processed');
      expect(processed.indexingStatus).toBe('indexed');
      expect(processed.chunksCount).toBe(1);
      expect(processed.extractedText).toContain('15 minutes');
      expect(aiIndexSpy).toHaveBeenCalledWith(
        '/documents/index',
        expect.objectContaining({
          document_id: docId.toString(),
          knowledge_base_id: orgAlphaKbId.toString(),
          organization_id: 'org_alpha',
        })
      );

      // Step B: Ask RAG Question via authenticated Node.js route
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockResolvedValue(alphaUser),
      });
      jest.spyOn(KnowledgeBase, 'findById').mockResolvedValue({
        _id: orgAlphaKbId,
        name: 'Security KB',
        owner: ownerId,
        visibility: 'organization',
        organization: 'org_alpha',
        status: 'active',
      });
      jest.spyOn(Document, 'find').mockResolvedValue([mockDocRecord]);

      jest.spyOn(ragClient, 'post').mockResolvedValue({
        data: {
          answer: 'Critical P1 security incidents must be escalated within 15 minutes [Evidence 1].',
          citations: [
            {
              document_id: docId.toString(),
              filename: tempFilename,
              chunk_id: `${docId.toString()}_c0000_abcd1234`,
              page_number: 1,
              excerpt: 'Critical P1 security incidents must be escalated within 15 minutes.',
              score: 0.94,
            },
          ],
          metadata: {
            knowledge_base_id: orgAlphaKbId.toString(),
            chunks_retrieved: 1,
            chunks_used: 1,
            model: 'gemini-2.5-flash',
            similarity_threshold: 0.65,
            insufficient_evidence: false,
          },
          conversationId: null,
        },
      });
      jest.spyOn(Conversation, 'create').mockResolvedValue({ _id: convId });

      const res = await request(app)
        .post('/api/rag/query')
        .set('Authorization', `Bearer ${signJwt(ownerId)}`)
        .send({
          question: 'What is the P1 incident escalation SLA?',
          knowledgeBaseId: orgAlphaKbId.toString(),
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.answer).toContain('15 minutes');
      expect(res.body.data.citations).toHaveLength(1);
      expect(res.body.data.citations[0].document_id).toBe(docId.toString());
      expect(res.body.data.citations[0].title).toBe('Incident Response SLA');
    } finally {
      await fs.unlink(tempFilePath).catch(() => {});
    }
  });

  it('blocks cross-organization user attempting to query org_alpha KB with 403 before AI call', async () => {
    jest.spyOn(User, 'findById').mockReturnValue({
      select: jest.fn().mockResolvedValue(betaUser),
    });
    jest.spyOn(KnowledgeBase, 'findById').mockResolvedValue({
      _id: orgAlphaKbId,
      name: 'Alpha Org KB',
      owner: ownerId,
      visibility: 'organization',
      organization: 'org_alpha',
      status: 'active',
    });

    const ragSpy = jest.spyOn(ragClient, 'post');

    const res = await request(app)
      .post('/api/rag/query')
      .set('Authorization', `Bearer ${signJwt(betaUser._id)}`)
      .send({
        question: 'Leak alpha org secrets',
        knowledgeBaseId: orgAlphaKbId.toString(),
      });

    expect(res.statusCode).toBe(403);
    expect(ragSpy).not.toHaveBeenCalled();
  });

  it('drops fabricated citations referencing non-existent document IDs in an empty KB', async () => {
    jest.spyOn(User, 'findById').mockReturnValue({
      select: jest.fn().mockResolvedValue(alphaUser),
    });
    jest.spyOn(KnowledgeBase, 'findById').mockResolvedValue({
      _id: orgAlphaKbId,
      name: 'Empty KB',
      owner: ownerId,
      visibility: 'private',
      organization: 'org_alpha',
      status: 'active',
    });
    jest.spyOn(Document, 'find').mockResolvedValue([]);

    // Simulate compromised/hallucinated upstream citation in empty KB
    jest.spyOn(ragClient, 'post').mockResolvedValue({
      data: {
        answer: 'Fabricated answer [Evidence 1]',
        citations: [
          {
            document_id: new mongoose.Types.ObjectId().toString(),
            filename: 'nonexistent.pdf',
            excerpt: 'Made up text',
            score: 0.99,
          },
        ],
        metadata: {
          knowledge_base_id: orgAlphaKbId.toString(),
          chunks_retrieved: 1,
          chunks_used: 1,
          model: 'gemini-2.5-flash',
          similarity_threshold: 0.65,
          insufficient_evidence: false,
        },
      },
    });
    jest.spyOn(Conversation, 'create').mockResolvedValue({ _id: convId });

    const res = await request(app)
      .post('/api/rag/query')
      .set('Authorization', `Bearer ${signJwt(ownerId)}`)
      .send({
        question: 'Any fabricated evidence?',
        knowledgeBaseId: orgAlphaKbId.toString(),
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.citations).toEqual([]);
    expect(res.body.data.metadata.insufficient_evidence).toBe(true);
    expect(res.body.data.answer).toMatch(/do not have sufficient evidence/i);
  });

  it('never leaks stack traces or credentials in HTTP error responses even when NODE_ENV=development', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockResolvedValue(alphaUser),
      });
      jest.spyOn(KnowledgeBase, 'findById').mockRejectedValue(
        new Error('DB error with mongodb+srv://rag:SuperSecretPass@cluster0.test.net and AIzaSyLeakedTest12345')
      );

      const res = await request(app)
        .post('/api/rag/query')
        .set('Authorization', `Bearer ${signJwt(ownerId)}`)
        .send({
          question: 'Trigger server error',
          knowledgeBaseId: orgAlphaKbId.toString(),
        });

      expect(res.statusCode).toBe(500);
      expect(res.body).not.toHaveProperty('stack');
      expect(res.body.message).not.toContain('SuperSecretPass');
      expect(res.body.message).not.toContain('AIzaSyLeakedTest12345');
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  it('rejects incorrect document ID formats with 400 cleanly on document routes', async () => {
    jest.spyOn(User, 'findById').mockReturnValue({
      select: jest.fn().mockResolvedValue(alphaUser),
    });

    const res = await request(app)
      .get('/api/documents/not-a-valid-objectid')
      .set('Authorization', `Bearer ${signJwt(ownerId)}`);

    expect(res.statusCode).toBe(400);
    expect(res.body).not.toHaveProperty('stack');
    expect(res.body.message).toMatch(/Invalid Document ID format/i);
  });
});
