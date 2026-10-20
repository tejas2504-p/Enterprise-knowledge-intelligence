import React, { useState, useRef } from 'react';
import { Upload, FileUp, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '../ui/Button';

export default function DocumentUploadZone({
  onUpload,
  uploading = false,
  isArchived = false,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  const handleFiles = (files) => {
    setUploadError(null);
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    const maxSize = 50 * 1024 * 1024; // 50MB
    const allowedExtensions = ['.pdf', '.txt', '.doc', '.docx', '.csv'];

    const invalidSize = fileList.filter((f) => f.size > maxSize);
    if (invalidSize.length > 0) {
      setUploadError(`Some files exceed the 50MB size limit (${invalidSize.map((f) => f.name).join(', ')}).`);
    }

    const validFiles = fileList.filter((file) => {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      return allowedExtensions.includes(ext) && file.size <= maxSize;
    });

    if (validFiles.length > 0) {
      onUpload(validFiles);
    } else if (invalidSize.length === 0) {
      setUploadError('Invalid file format. Please upload PDF, TXT, DOC, DOCX, or CSV files.');
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isArchived && !uploading) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (!isArchived && !uploading && e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  };

  return (
    <div className="space-y-3">
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
        accept=".pdf,.txt,.doc,.docx,.csv"
        multiple
        disabled={uploading || isArchived}
      />

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-xl p-8 sm:p-10 text-center transition-all duration-200 ${
          isDragging
            ? 'border-primary-500 bg-primary-50/70 scale-[1.005]'
            : isArchived
            ? 'border-slate-200 bg-slate-50/60 cursor-not-allowed opacity-60'
            : 'border-slate-300 bg-white hover:bg-slate-50/60 hover:border-primary-400/70'
        }`}
      >
        <div className="flex flex-col items-center justify-center max-w-md mx-auto pointer-events-none">
          <div
            className={`p-4 rounded-full mb-3.5 ${
              isDragging
                ? 'bg-primary-100 text-primary-600'
                : 'bg-slate-100 text-slate-500'
            }`}
          >
            {uploading ? (
              <Loader2 size={32} className="animate-spin text-primary-600" />
            ) : (
              <Upload size={32} />
            )}
          </div>

          <h3 className="text-base font-semibold text-slate-800 mb-1">
            {uploading
              ? 'Uploading documents...'
              : isDragging
              ? 'Drop documents here to upload'
              : 'Drag & drop documents here'}
          </h3>

          <p className="text-xs text-slate-500 mb-4 max-w-sm">
            Supported formats: PDF, DOCX, DOC, TXT, CSV (up to 50MB each). Files will be queued for text extraction.
          </p>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading || isArchived}
            onClick={() => fileInputRef.current?.click()}
            className="pointer-events-auto gap-2"
          >
            {uploading ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                <span>Uploading...</span>
              </>
            ) : (
              <>
                <FileUp size={15} />
                <span>Browse Files</span>
              </>
            )}
          </Button>

          {isArchived && (
            <p className="text-xs text-amber-600 font-medium mt-3 pointer-events-auto">
              This knowledge base is archived. Unarchive in settings to upload new documents.
            </p>
          )}
        </div>
      </div>

      {uploadError && (
        <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">
          <AlertCircle size={15} className="shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}
    </div>
  );
}
