import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FileText,
  X,
  AlertCircle,
  Calendar,
  User,
  HardDrive,
  FileType2,
  BookOpen,
  AlignLeft,
  Hash,
  Quote,
  Database,
  Loader2,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { ProcessingStatusBadge } from '../ui/Badge';
import { getDocument } from '../../services/docService';
import { formatBytes, formatDateTime, formatNumber } from '../../utils/formatters';

export default function CitationDetailModal({ citation, isOpen, onClose, knowledgeBaseId }) {
  const [docDetails, setDocDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen || !citation?.document_id) return;

    let active = true;
    const loadDocument = async () => {
      try {
        setLoading(true);
        setError(null);
        setDocDetails(null);
        const res = await getDocument(citation.document_id);
        if (active) {
          setDocDetails(res.data || null);
        }
      } catch (err) {
        if (active) {
          const msg =
            err.response?.status === 403
              ? 'Access denied: you do not have permission to view full metadata for this document.'
              : err.response?.data?.message || 'Unable to load full document metadata.';
          setError(msg);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadDocument();
    return () => {
      active = false;
    };
  }, [isOpen, citation?.document_id]);

  if (!isOpen || !citation) return null;

  const displayName =
    docDetails?.title ||
    citation.title ||
    docDetails?.originalFileName ||
    citation.filename ||
    'Source Document';

  const targetKbId = docDetails?.knowledgeBase || knowledgeBaseId;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="citation-modal-title"
    >
      <div className="fixed inset-0" onClick={onClose} />

      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden z-10 border border-slate-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 bg-primary-50 text-primary-600 rounded-lg shrink-0">
              <FileText size={18} />
            </div>
            <div className="min-w-0">
              <h3 id="citation-modal-title" className="text-base font-semibold text-slate-900 truncate">
                {displayName}
              </h3>
              <p className="text-xs text-slate-500 truncate">
                Retrieved Source Citation &amp; Document Details
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close source details"
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-md hover:bg-slate-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Retrieved Chunk Excerpt Highlight */}
          <div className="rounded-lg border border-primary-200/80 bg-primary-50/40 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-primary-700 inline-flex items-center gap-1.5">
                <Quote size={14} />
                <span>Matched Source Excerpt</span>
              </span>
              <div className="flex items-center gap-2">
                {citation.page_number !== null && citation.page_number !== undefined && (
                  <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-700 font-medium">
                    Page {citation.page_number}
                  </span>
                )}
                {citation.chunk_id && (
                  <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-500 font-mono text-[11px]">
                    {citation.chunk_id}
                  </span>
                )}
                {typeof citation.score === 'number' && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-medium">
                    {Math.round(citation.score * 100)}% relevance
                  </span>
                )}
              </div>
            </div>
            <blockquote className="text-sm text-slate-800 bg-white border border-slate-200/80 rounded-md p-3.5 leading-relaxed whitespace-pre-wrap">
              {citation.excerpt}
            </blockquote>
          </div>

          {/* Authoritative Document Metadata */}
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-sm text-slate-500">
              <Loader2 size={18} className="animate-spin text-primary-600" />
              <span>Loading document details...</span>
            </div>
          ) : error ? (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2.5">
              <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Document Metadata Notice</p>
                <p className="mt-0.5 text-amber-700">{error}</p>
              </div>
            </div>
          ) : docDetails ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200/70">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-600">Processing Status:</span>
                  <ProcessingStatusBadge status={docDetails.processingStatus} />
                </div>
                {docDetails.fileType && (
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 px-2 py-0.5 bg-white rounded border border-slate-200">
                    {docDetails.fileType}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50 space-y-1">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <FileType2 size={13} /> Original Filename
                  </span>
                  <p className="font-medium text-slate-800 truncate" title={docDetails.originalFileName}>
                    {docDetails.originalFileName || citation.filename || '-'}
                  </p>
                </div>

                <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50 space-y-1">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <HardDrive size={13} /> File Size
                  </span>
                  <p className="font-medium text-slate-800">
                    {formatBytes(docDetails.fileSize || 0)}
                  </p>
                </div>

                <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50 space-y-1">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <User size={13} /> Uploaded By
                  </span>
                  <p className="font-medium text-slate-800 truncate">
                    {docDetails.uploadedBy?.name || 'Authorized User'}
                  </p>
                </div>

                <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/50 space-y-1">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Calendar size={13} /> Upload Date
                  </span>
                  <p className="font-medium text-slate-800">
                    {formatDateTime(docDetails.createdAt)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-center">
                  <div className="flex items-center justify-center text-slate-400 mb-1">
                    <BookOpen size={15} />
                  </div>
                  <div className="text-base font-bold text-slate-800">
                    {formatNumber(docDetails.pageCount)}
                  </div>
                  <div className="text-[11px] text-slate-500 uppercase tracking-wide">Pages</div>
                </div>

                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-center">
                  <div className="flex items-center justify-center text-slate-400 mb-1">
                    <AlignLeft size={15} />
                  </div>
                  <div className="text-base font-bold text-slate-800">
                    {formatNumber(docDetails.wordCount)}
                  </div>
                  <div className="text-[11px] text-slate-500 uppercase tracking-wide">Words</div>
                </div>

                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-center">
                  <div className="flex items-center justify-center text-slate-400 mb-1">
                    <Hash size={15} />
                  </div>
                  <div className="text-base font-bold text-slate-800">
                    {formatNumber(docDetails.chunksCount)}
                  </div>
                  <div className="text-[11px] text-slate-500 uppercase tracking-wide">Chunks</div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          {targetKbId && (
            <Link to={`/knowledge-bases/${targetKbId}`} onClick={onClose}>
              <Button variant="outline" size="sm" className="gap-2">
                <Database size={14} />
                <span>View Knowledge Base</span>
              </Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
