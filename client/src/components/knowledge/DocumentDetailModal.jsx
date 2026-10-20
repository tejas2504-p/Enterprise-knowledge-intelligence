import React from 'react';
import { 
  FileText, 
  X, 
  Trash2, 
  AlertCircle, 
  Calendar, 
  User, 
  HardDrive, 
  FileType2, 
  Hash, 
  BookOpen, 
  AlignLeft 
} from 'lucide-react';
import { Button } from '../ui/Button';
import { ProcessingStatusBadge } from '../ui/Badge';
import { formatBytes, formatDateTime, formatNumber } from '../../utils/formatters';

export default function DocumentDetailModal({
  doc,
  isOpen,
  onClose,
  onDelete,
  isArchived = false,
}) {
  if (!isOpen || !doc) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm transition-all duration-200">
      <div 
        className="fixed inset-0" 
        onClick={onClose} 
      />

      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-150 border border-slate-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 bg-primary-50 text-primary-600 rounded-lg shrink-0">
              <FileText size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-slate-900 truncate">
                {doc.title || doc.originalFileName}
              </h3>
              <p className="text-xs text-slate-500 truncate">
                Document Details & Processing State
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-md hover:bg-slate-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Status Banner */}
          <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-lg border border-slate-200/70">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-600">Processing Status:</span>
              <ProcessingStatusBadge status={doc.processingStatus} />
            </div>
            {doc.fileType && (
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-2 py-0.5 bg-white rounded border border-slate-200">
                {doc.fileType}
              </span>
            )}
          </div>

          {/* Processing Error Alert */}
          {doc.processingStatus === 'failed' && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 space-y-1">
              <div className="font-semibold flex items-center gap-1.5 text-red-700">
                <AlertCircle size={15} />
                <span>Extraction / Ingestion Failed</span>
              </div>
              <p className="text-red-600 leading-relaxed">
                {doc.processingError || 'An unexpected error occurred while parsing the document contents.'}
              </p>
            </div>
          )}

          {/* Metadata Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50 space-y-1">
              <span className="text-slate-400 flex items-center gap-1.5">
                <FileType2 size={13} /> Original Filename
              </span>
              <p className="font-medium text-slate-800 truncate" title={doc.originalFileName}>
                {doc.originalFileName || '-'}
              </p>
            </div>

            <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50 space-y-1">
              <span className="text-slate-400 flex items-center gap-1.5">
                <HardDrive size={13} /> File Size
              </span>
              <p className="font-medium text-slate-800">
                {formatBytes(doc.fileSize || 0)}
              </p>
            </div>

            <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50 space-y-1">
              <span className="text-slate-400 flex items-center gap-1.5">
                <User size={13} /> Uploaded By
              </span>
              <p className="font-medium text-slate-800 truncate">
                {doc.uploadedBy?.name || 'Current User'}
              </p>
            </div>

            <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50 space-y-1">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Calendar size={13} /> Upload Date
              </span>
              <p className="font-medium text-slate-800">
                {formatDateTime(doc.createdAt)}
              </p>
            </div>
          </div>

          {/* Extraction Metrics */}
          <div>
            <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-3">
              Extracted Content Metrics
            </h4>
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-100 text-center">
                <div className="flex items-center justify-center text-slate-400 mb-1">
                  <BookOpen size={16} />
                </div>
                <div className="text-lg font-bold text-slate-800">
                  {formatNumber(doc.pageCount) || '-'}
                </div>
                <div className="text-[11px] text-slate-500 uppercase tracking-wide mt-0.5">
                  Pages
                </div>
              </div>

              <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-100 text-center">
                <div className="flex items-center justify-center text-slate-400 mb-1">
                  <AlignLeft size={16} />
                </div>
                <div className="text-lg font-bold text-slate-800">
                  {formatNumber(doc.wordCount) || '-'}
                </div>
                <div className="text-[11px] text-slate-500 uppercase tracking-wide mt-0.5">
                  Words
                </div>
              </div>

              <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-100 text-center">
                <div className="flex items-center justify-center text-slate-400 mb-1">
                  <Hash size={16} />
                </div>
                <div className="text-lg font-bold text-slate-800">
                  {formatNumber(doc.characterCount) || '-'}
                </div>
                <div className="text-[11px] text-slate-500 uppercase tracking-wide mt-0.5">
                  Characters
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
          >
            Close
          </Button>

          {!isArchived && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                onDelete(doc);
              }}
              className="gap-2"
            >
              <Trash2 size={14} />
              <span>Delete Document</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
