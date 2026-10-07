import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

class LocalStorageProvider {
  constructor() {
    this.ensureUploadsDir();
  }

  async ensureUploadsDir() {
    try {
      await fs.access(UPLOADS_DIR);
    } catch {
      await fs.mkdir(UPLOADS_DIR, { recursive: true });
    }
  }

  async uploadFile(tempFilePath, originalFilename, mimeType) {
    await this.ensureUploadsDir();
    
    // Validate and sanitize extension to prevent path traversal or execution
    const ext = path.extname(originalFilename).toLowerCase();
    const safeExt = ext.replace(/[^a-z0-9.]/g, '');
    
    // Generate secure random filename
    const fileName = crypto.randomBytes(16).toString('hex') + (safeExt || '.bin');
    const finalPath = path.join(UPLOADS_DIR, fileName);
    
    // Move file from temp to final destination
    await fs.rename(tempFilePath, finalPath);
    
    return {
      url: `/uploads/${fileName}`, // This would be the public URL if we serve it, or we just store it
      storageKey: fileName,
      provider: 'local',
      localPath: finalPath
    };
  }

  async deleteFile(storageKey) {
    if (!storageKey) return;
    
    // Prevent path traversal by extracting basename
    const safeKey = path.basename(storageKey);
    const filePath = path.join(UPLOADS_DIR, safeKey);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.error(`Failed to delete file: ${filePath}`, error);
    }
  }
}

export const storageProvider = new LocalStorageProvider();
