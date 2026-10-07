import fs from 'fs/promises';
import path from 'path';
import Document from '../models/Document.js';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

class DocumentProcessingService {
  /**
   * Process a document to extract text and metadata.
   * @param {string} documentId - The ID of the document to process.
   */
  async processDocument(documentId) {
    try {
      const document = await Document.findById(documentId);
      if (!document) {
        throw new Error(`Document with ID ${documentId} not found`);
      }

      // Set processingStatus to processing
      document.processingStatus = 'processing';
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
        const data = await pdfParse(fileBuffer);
        extractedText = data.text;
        pageCount = data.numpages;
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

      // Normalize whitespace
      extractedText = extractedText.replace(/\s+/g, ' ').trim();

      // Calculate counts
      const wordCount = extractedText.length > 0 ? extractedText.split(/\s+/).length : 0;
      const characterCount = extractedText.length;

      // Update document fields
      document.extractedText = extractedText;
      if (pageCount !== null) {
        document.pageCount = pageCount;
      }
      document.wordCount = wordCount;
      document.characterCount = characterCount;
      document.processingStatus = 'processed';
      document.processingError = null;

      await document.save();
      return document;
    } catch (error) {
      console.error(`Error processing document ${documentId}:`, error);

      // On failure, set safe error message and update status
      try {
        const documentToUpdate = await Document.findById(documentId);
        if (documentToUpdate) {
          documentToUpdate.processingStatus = 'failed';
          documentToUpdate.processingError = 'Failed to extract text from document.';
          await documentToUpdate.save();
        }
      } catch (updateError) {
        console.error(`Failed to update processing status for document ${documentId}:`, updateError);
      }
    }
  }
}

export const documentProcessingService = new DocumentProcessingService();
