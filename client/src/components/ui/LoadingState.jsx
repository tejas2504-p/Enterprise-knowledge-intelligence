import React from 'react';
import { Loader2 } from 'lucide-react';
import { Card } from './Card';

export function LoadingSpinner({ message = 'Loading...', size = 32, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center py-20 gap-3 ${className}`}>
      <Loader2 className="animate-spin text-primary-600" size={size} />
      {message && <p className="text-sm font-medium text-slate-500">{message}</p>}
    </div>
  );
}

export function CardSkeleton({ count = 6 }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="p-6 h-56 flex flex-col justify-between border-slate-200">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-slate-200" />
                <div className="space-y-2">
                  <div className="h-4 w-32 bg-slate-200 rounded" />
                  <div className="h-3 w-20 bg-slate-100 rounded" />
                </div>
              </div>
              <div className="w-6 h-6 rounded bg-slate-100" />
            </div>
            <div className="space-y-2 pt-2">
              <div className="h-3 w-full bg-slate-100 rounded" />
              <div className="h-3 w-3/4 bg-slate-100 rounded" />
            </div>
          </div>
          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            <div className="h-4 w-20 bg-slate-200 rounded-full" />
            <div className="h-3 w-24 bg-slate-100 rounded" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 6 }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm animate-pulse">
      <div className="h-12 bg-slate-50 border-b border-slate-200 flex items-center px-6 gap-4">
        {Array.from({ length: cols }).map((_, idx) => (
          <div key={idx} className="h-3 bg-slate-200 rounded flex-1" />
        ))}
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, rIdx) => (
          <div key={rIdx} className="h-16 px-6 flex items-center gap-4">
            {Array.from({ length: cols }).map((_, cIdx) => (
              <div key={cIdx} className="h-3.5 bg-slate-100 rounded flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatsSkeleton({ count = 4 }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="p-6 border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <div className="h-3.5 w-24 bg-slate-200 rounded" />
            <div className="w-8 h-8 rounded-lg bg-slate-100" />
          </div>
          <div className="h-7 w-28 bg-slate-200 rounded mb-2" />
          <div className="h-3 w-16 bg-slate-100 rounded" />
        </Card>
      ))}
    </div>
  );
}
