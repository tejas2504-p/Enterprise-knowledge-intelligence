import React from 'react';
import { cn } from '../../utils/cn';
import { 
  Lock, 
  Users, 
  Building2, 
  CheckCircle2, 
  Loader2, 
  AlertCircle, 
  Clock, 
  Archive,
  Sparkles
} from 'lucide-react';

export function VisibilityBadge({ visibility, className }) {
  const normalized = (visibility || 'private').toLowerCase();

  switch (normalized) {
    case 'organization':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200/60',
            className
          )}
        >
          <Building2 size={12} className="shrink-0" />
          <span>Organization</span>
        </span>
      );
    case 'department':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200/60',
            className
          )}
        >
          <Users size={12} className="shrink-0" />
          <span>Department</span>
        </span>
      );
    case 'private':
    default:
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200/80',
            className
          )}
        >
          <Lock size={12} className="shrink-0" />
          <span>Private</span>
        </span>
      );
  }
}

export function StatusBadge({ status, className }) {
  const normalized = (status || 'active').toLowerCase();

  if (normalized === 'active') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/60',
          className
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span>Active</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200/60',
        className
      )}
    >
      <Archive size={12} className="shrink-0" />
      <span>Archived</span>
    </span>
  );
}

export function ProcessingStatusBadge({ status, className }) {
  const normalized = (status || 'uploaded').toLowerCase();

  switch (normalized) {
    case 'processed':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/60',
            className
          )}
        >
          <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
          <span>Processed</span>
        </span>
      );
    case 'processing':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200/60',
            className
          )}
        >
          <Loader2 size={13} className="text-blue-600 animate-spin shrink-0" />
          <span>Processing</span>
        </span>
      );
    case 'failed':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200/60',
            className
          )}
        >
          <AlertCircle size={13} className="text-rose-600 shrink-0" />
          <span>Failed</span>
        </span>
      );
    case 'uploaded':
    default:
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200/80',
            className
          )}
        >
          <Clock size={13} className="text-slate-500 shrink-0" />
          <span>Uploaded</span>
        </span>
      );
  }
}
