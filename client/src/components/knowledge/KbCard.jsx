import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/Card';
import { VisibilityBadge, StatusBadge } from '../ui/Badge';
import { Database, FileText, User } from 'lucide-react';
import { formatBytes, formatDate } from '../../utils/formatters';
import KbActionsMenu from './KbActionsMenu';

export default function KbCard({ kb, onDelete }) {
  const navigate = useNavigate();

  const ownerName = kb.owner?.name || (typeof kb.owner === 'string' ? 'Owner' : 'Unknown');
  const ownerInitial = ownerName.charAt(0).toUpperCase();

  return (
    <Card 
      onClick={() => navigate(`/knowledge-bases/${kb._id}`)}
      className="h-full hover:shadow-soft-lg transition-all duration-200 flex flex-col group hover:border-primary-300/80 cursor-pointer border-slate-200 bg-white"
    >
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start gap-2">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2.5 bg-primary-50 text-primary-600 rounded-lg group-hover:bg-primary-600 group-hover:text-white transition-colors shrink-0">
              <Database size={20} />
            </div>
            <div className="min-w-0">
              <Link 
                to={`/knowledge-bases/${kb._id}`} 
                onClick={(e) => e.stopPropagation()}
                className="hover:text-primary-600 transition-colors inline-block max-w-full"
              >
                <CardTitle className="text-base font-semibold truncate text-slate-900 group-hover:text-primary-600 transition-colors">
                  {kb.name}
                </CardTitle>
              </Link>
              {kb.department && (
                <p className="text-xs text-slate-400 truncate mt-0.5 font-medium">
                  {kb.department}
                </p>
              )}
            </div>
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <KbActionsMenu kb={kb} onDelete={onDelete} />
          </div>
        </div>
        
        <CardDescription className="line-clamp-2 mt-2.5 text-xs text-slate-500 leading-relaxed min-h-[2rem]">
          {kb.description || 'No description provided.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="mt-auto pt-2 space-y-4">
        {/* Badges */}
        <div className="flex flex-wrap items-center gap-2">
          <VisibilityBadge visibility={kb.visibility} />
          <StatusBadge status={kb.status} />
        </div>

        {/* Stats & Meta Footer */}
        <div className="border-t border-slate-100 pt-3 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 font-medium text-slate-700">
              <FileText size={13} className="text-slate-400" />
              {kb.documentCount || 0} docs
            </span>
            <span className="text-slate-300">•</span>
            <span>{formatBytes(kb.totalSize || 0)}</span>
          </div>

          <div className="text-right text-slate-400 text-[11px]">
            {formatDate(kb.updatedAt || kb.createdAt)}
          </div>
        </div>

        {/* Owner Info */}
        <div className="flex items-center justify-between pt-1 border-t border-slate-50 text-xs">
          <div className="flex items-center gap-2 min-w-0 text-slate-600">
            <div className="w-5 h-5 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-semibold text-slate-700 shrink-0">
              {ownerInitial}
            </div>
            <span className="truncate text-slate-500 text-[11px]">
              {ownerName}
            </span>
          </div>
          <span className="text-[11px] font-medium text-primary-600 opacity-0 group-hover:opacity-100 transition-opacity">
            View &rarr;
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
