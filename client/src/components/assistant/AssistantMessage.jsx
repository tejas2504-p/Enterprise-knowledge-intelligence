import React from 'react';
import { Bot, User as UserIcon, AlertTriangle, BookOpenCheck } from 'lucide-react';
import CitationCard from './CitationCard';

export default function AssistantMessage({ message, onSelectCitation }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end items-start gap-3">
        <div className="max-w-2xl bg-primary-600 text-white px-4 py-3 rounded-2xl rounded-tr-sm shadow-sm text-sm leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>
        <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center shrink-0 mt-0.5">
          <UserIcon size={16} />
        </div>
      </div>
    );
  }

  const citations = Array.isArray(message.citations) ? message.citations : [];
  const meta = message.metadata || {};
  const isInsufficient = Boolean(message.insufficientEvidence || meta.insufficient_evidence);

  return (
    <div className="flex justify-start items-start gap-3">
      <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 text-primary-600 flex items-center justify-center shrink-0 mt-0.5">
        <Bot size={16} />
      </div>

      <div className="flex-1 max-w-3xl bg-white border border-slate-200 rounded-2xl rounded-tl-sm shadow-sm p-4 sm:p-5 space-y-4">
        {/* Insufficient Evidence Notice */}
        {isInsufficient && (
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-50 border border-amber-200/80 text-xs text-amber-800">
            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Insufficient Evidence</span>
              <p className="text-amber-700 mt-0.5">
                {meta.no_indexed_documents
                  ? 'No indexed documents with searchable evidence were found in this knowledge base.'
                  : 'The retrieved document chunks did not contain enough high-confidence evidence to answer this question reliably.'}
              </p>
            </div>
          </div>
        )}

        {/* Answer Content */}
        <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>

        {/* Retrieved Source Citations */}
        {citations.length > 0 && (
          <div className="pt-3 border-t border-slate-100 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 inline-flex items-center gap-1.5">
                <BookOpenCheck size={14} className="text-primary-600" />
                <span>Sources ({citations.length})</span>
              </span>
              <span className="text-[11px] text-slate-400">Click any source to inspect details</span>
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              {citations.map((citation, idx) => (
                <CitationCard
                  key={`${citation.document_id}-${citation.chunk_id || idx}`}
                  citation={citation}
                  index={idx}
                  onSelectCitation={onSelectCitation}
                />
              ))}
            </div>
          </div>
        )}

        {/* Telemetry Metadata Footer */}
        {(meta.model || meta.chunks_retrieved !== undefined) && (
          <div className="pt-2 border-t border-slate-50 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
            {meta.model && <span>Model: {meta.model}</span>}
            {meta.chunks_used !== undefined && meta.chunks_retrieved !== undefined && (
              <span>
                Evidence chunks: {meta.chunks_used} used of {meta.chunks_retrieved} retrieved
              </span>
            )}
            {meta.similarity_threshold !== undefined && (
              <span>Min relevance: {Math.round(meta.similarity_threshold * 100)}%</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
