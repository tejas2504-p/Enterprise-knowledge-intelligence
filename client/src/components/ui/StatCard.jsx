import React from 'react';
import { Card, CardContent } from './Card';
import { cn } from '../../utils/cn';

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = 'text-primary-600',
  iconBg = 'bg-primary-50',
  className = '',
}) {
  return (
    <Card className={cn('bg-white border-slate-200/90 hover:border-slate-300 transition-all duration-200', className)}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {title}
          </span>
          {Icon && (
            <div className={cn('p-2.5 rounded-lg flex items-center justify-center', iconBg, iconColor)}>
              <Icon size={18} strokeWidth={2} />
            </div>
          )}
        </div>
        <div className="text-2xl font-bold text-slate-900 tracking-tight">
          {value}
        </div>
        {subtitle && (
          <p className="mt-1.5 text-xs text-slate-500 truncate">
            {subtitle}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
