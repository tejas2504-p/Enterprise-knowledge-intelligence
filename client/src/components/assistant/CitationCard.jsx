import React, { useState } from 'react';
import { FileText, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';

export default function CitationCard({ citation, index, onSelectCitation }) {
  const [expanded, setExpanded] = useState(false);

  const label = citation.title || citation.filename || 'Source Document';
  const matchPct =
    typeof citation.score === 'number' ? `${Math.round(citation.score * 100)}% match` : null;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 hover:bg-white hover:border-primary-300 transition-all overflow-hidden">
      <div className="p-3 space-y-2">
        {/* Top Row: Document title + badges + inspect detail trigger */}
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => onSelectCitation && onSelectCitation(citation)}
            className="flex items-center gap-2 text-left min-w-0 group focus:outline-none"
            aria-label={`View source details for ${label}`}
          >
            <div className="p-1.5 bg-primary-50 text-primary-600 rounded-md shrink-0 group-hover:bg-primary-600 group-hover:text-white transition-colors">
              <FileText size={14} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold text-slate-900 group-hover:text-primary-600 truncate max-w-[200px] sm:max-w-[260px]">
                  [{index + 1}] {label}
                </span>
                <ExternalLink
                  size={12}
                  className="text-slate-400 group-hover:text-primary-600 shrink-0"
                />
              </div>
              {citation.filename && citation.title && citation.filename !== citation.title && (
                <p className="text-[11px] text-slate-500 truncate">{citation.filename}</p>
              )}
            </div>
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            {citation.page_number !== null && citation.page_number !== undefined && (
              <span className="px-2 py-0.5 text-[11px] font-medium bg-white border border-slate-200 text-slate-600 rounded-full">
                Page {citation.page_number}
              </span>
            )}
            {matchPct && (
              <span className="px-2 py-0.5 text-[11px] font-medium bg-emerald-50 border border-emerald-200/70 text-emerald-700 rounded-full">
                {matchPct}
              </span>
            )}
          </div>
        </div>

        {/* Source Excerpt Preview */}
        {citation.excerpt && (
          <div className="text-xs text-slate-600 bg-white border border-slate-200/70 rounded-md px-2.5 py-2 leading-relaxed">
            <p className={expanded ? '' : 'line-clamp-2'}>{citation.excerpt}</p>
            <div className="mt-1.5 flex items-center justify-between text-[11px]">
              {citation.excerpt.length > 110 ? (
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => !prev)}
                  className="text-primary-600 hover:text-primary-700 font-medium inline-flex items-center gap-1"
                >
                  {expanded ? (
                    <>
                      <span>Show less</span>
                      <ChevronUp size={12} />
                    </>
                  ) : (
                    <>
                      <span>Preview excerpt</span>
                      <ChevronDown size={12} />
                    </>
                  )}
                </button>
              ) : (
                <span />
              )}

              <button
                type="button"
                onClick={() => onSelectCitation && onSelectCitation(citation)}
                className="text-slate-500 hover:text-primary-600 font-medium"
              >
                Source details &rarr;
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
