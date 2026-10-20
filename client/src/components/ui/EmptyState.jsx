import React from 'react';
import { Card } from './Card';
import { Button } from './Button';
import { Database, Plus } from 'lucide-react';

export function EmptyState({
  icon: Icon = Database,
  title = 'No items found',
  description = 'Get started by creating your first entry.',
  actionLabel,
  onAction,
  className = '',
  actionIcon: ActionIcon = Plus,
}) {
  return (
    <Card className={`text-center py-16 px-6 border-dashed border-2 border-slate-200/90 shadow-sm bg-white/70 ${className}`}>
      <div className="flex justify-center mb-4">
        <div className="p-4 bg-primary-50/80 rounded-2xl ring-8 ring-primary-50/30 text-primary-600">
          <Icon size={40} strokeWidth={1.75} />
        </div>
      </div>
      <h3 className="text-lg font-semibold text-slate-800 tracking-tight mb-2">
        {title}
      </h3>
      <p className="text-sm text-slate-500 max-w-sm mx-auto mb-6 leading-relaxed">
        {description}
      </p>
      {actionLabel && onAction && (
        <Button onClick={onAction} className="gap-2 shadow-sm inline-flex">
          {ActionIcon && <ActionIcon size={16} />}
          <span>{actionLabel}</span>
        </Button>
      )}
    </Card>
  );
}
