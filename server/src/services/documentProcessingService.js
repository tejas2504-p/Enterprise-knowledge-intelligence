import fs from 'fs/promises';
import path from 'path';
import Document from '../models/Document.js';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { indexDocumentInAI, batchIndexDocumentsInAI } from './aiServiceClient.js';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

class DocumentProcessingService {
  /**
   * Process a document to extract text and metadata (Phase 2),
   * then seamlessly trigger Phase 3 vector indexing without coupling statuses.
   * @param {string} documentId - The ID of the document to process.
   */
  async processDocument(documentId) {
    let document;
    try {
      document = await Document.findById(documentId).populate('knowledgeBase');
      if (!document) {
        throw new Error(`Document with ID ${documentId} not found`);
      }

      // Set Phase 2 processingStatus to processing
      document.processingStatus = 'processing';
      document.processingError = null;
      await document.save();

      // Read the stored file
      const safeKey = path.basename(document.storageKey);
      const filePath = path.join(UPLOADS_DIR, safeKey);

      let extractedText = '';
      let pageCount = null;

      const fileExtension = path.extname(document.originalFileName).toLowerCase();
      const mimeType = document.mimeType;

      // Extract text based on file type
      if (mimeType === 'application/pdf' || fileExtension === '.pdf') {
        const fileBuffer = await fs.readFile(filePath);
        const parser = new PDFParse({ data: fileBuffer });
        try {
          const data = await parser.getText();
          extractedText = data.text;
          pageCount = data.total;
        } finally {
          await parser.destroy();
        }
      } else if (
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        fileExtension === '.docx'
      ) {
        const result = await mammoth.extractRawText({ path: filePath });
        extractedText = result.value;
      } else if (
        mimeType === 'text/plain' ||
        mimeType === 'text/markdown' ||
        ['.txt', '.md', '.markdown'].includes(fileExtension)
      ) {
        extractedText = await fs.readFile(filePath, 'utf-8');
      } else {
        throw new Error('Unsupported file format for text extraction');
      }

      // Normalize horizontal whitespace and excessive blank lines while preserving paragraph and line breaks
      extractedText = extractedText
        .replace(/[^\S\r\n\f]+/g, ' ')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      // Calculate counts
      const wordCount = extractedText.length > 0 ? extractedText.split(/\s+/).length : 0;
      const characterCount = extractedText.length;

      // Phase 2 Extraction Successful
      document.extractedText = extractedText;
      if (pageCount !== null) {
        document.pageCount = pageCount;
      }
      document.wordCount = wordCount;
      document.characterCount = characterCount;
      document.processingStatus = 'processed';
      document.processingError = null;
      document.indexingStatus = 'processing';
      await document.save();

    } catch (extractionError) {
      console.error(`Text extraction failed for document ${documentId}:`, extractionError.message);
      try {
        const docToUpdate = await Document.findById(documentId);
        if (docToUpdate) {
          docToUpdate.processingStatus = 'failed';
          docToUpdate.processingError = 'Failed to extract text from document: ' + extractionError.message;
          await docToUpdate.save();
        }
      } catch (saveErr) {
        console.error(`Failed to record extraction error for document ${documentId}:`, saveErr);
      }
      return null;
    }

    // Phase 3: Trigger Vector Indexing (decoupled from Phase 2 extraction status)
    try {
      const indexResult = await indexDocumentInAI(document);
      document.indexingStatus = 'indexed';
      document.indexedAt = new Date();
      document.chunksCount = indexResult.chunks_indexed || 0;
      document.indexingError = null;
      await document.save();
    } catch (indexingError) {
      console.error(`Vector indexing failed for document ${documentId}:`, indexingError.message);
      document.indexingStatus = 'failed';
      document.indexingError = indexingError.message;
      await document.save();
      // Notice: document.processingStatus remains 'processed'! Text extraction is preserved.
    }

    return document;
  }

  /**
   * Index an already-processed document without re-extracting PDF or DOCX file.
   * @param {string} documentId - The ID of the document to index.
   */
  async indexExistingDocument(documentId) {
    const document = await Document.findById(documentId).populate('knowledgeBase');
    if (!document) {
      throw new Error(`Document with ID ${documentId} not found`);
    }

    // If text was never extracted, trigger full extraction pipeline first
    if (document.processingStatus !== 'processed' || !document.extractedText) {
      return this.processDocument(documentId);
    }

    // Reuse existing extracted text; do NOT re-extract from file
    document.indexingStatus = 'processing';
    document.indexingError = null;
    await document.save();

    try {
      const indexResult = await indexDocumentInAI(document);
      document.indexingStatus = 'indexed';
      document.indexedAt = new Date();
      document.chunksCount = indexResult.chunks_indexed || 0;
      document.indexingError = null;
      await document.save();
      return document;
    } catch (indexingError) {
      console.error(`Re-indexing failed for document ${documentId}:`, indexingError.message);
      document.indexingStatus = 'failed';
      document.indexingError = indexingError.message;
      await document.save();
      throw indexingError;
    }
  }

  /**
   * Batch index multiple documents by ID, reusing existing extracted text.
   * Handles partial failures safely without failing the entire batch.
   * @param {string[]} documentIds - List of document IDs to index.
   */
  async batchIndexDocuments(documentIds) {
    const documents = await Document.find({
      _id: { $in: documentIds },
      processingStatus: 'processed',
    }).populate('knowledgeBase');

    const results = {
      total: documentIds.length,
      indexed: 0,
      failed: 0,
      details: [],
    };

    for (const doc of documents) {
      try {
        doc.indexingStatus = 'processing';
        doc.indexingError = null;
        await doc.save();

        const indexResult = await indexDocumentInAI(doc);
        doc.indexingStatus = 'indexed';
        doc.indexedAt = new Date();
        doc.chunksCount = indexResult.chunks_indexed || 0;
        doc.indexingError = null;
        await doc.save();

        results.indexed += 1;
        results.details.push({
          document_id: doc._id.toString(),
          status: 'indexed',
          chunks_indexed: doc.chunksCount,
        });
      } catch (err) {
        doc.indexingStatus = 'failed';
        doc.indexingError = err.message;
        await doc.save();

        results.failed += 1;
        results.details.push({
          document_id: doc._id.toString(),
          status: 'failed',
          error: err.message,
        });
      }
    }

    return results;
  }
}

export const documentProcessingService = new DocumentProcessingService();
