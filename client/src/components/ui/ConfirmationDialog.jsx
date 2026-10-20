import React, { useEffect } from 'react';
import { AlertTriangle, Info, Loader2, X } from 'lucide-react';
import { Button } from './Button';

export function ConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  description = 'This action cannot be undone.',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'destructive',
  loading = false,
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && !loading) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  const isDestructive = variant === 'destructive' || variant === 'danger';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm transition-all duration-200">
      <div 
        className="fixed inset-0" 
        onClick={loading ? undefined : onClose} 
      />
      
      <div className="relative bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-100 z-10 transition-all transform scale-100 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-start gap-4">
          <div
            className={`p-3 rounded-full shrink-0 ${
              isDestructive ? 'bg-red-50 text-red-600' : 'bg-primary-50 text-primary-600'
            }`}
          >
            {isDestructive ? <AlertTriangle size={22} /> : <Info size={22} />}
          </div>
          
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-slate-900 leading-snug">
              {title}
            </h3>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              {description}
            </p>
          </div>

          <button
            onClick={loading ? undefined : onClose}
            disabled={loading}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md transition-colors -mr-1 -mt-1"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={loading}
          >
            {cancelText}
          </Button>
          <Button
            variant={isDestructive ? 'destructive' : 'primary'}
            size="sm"
            onClick={onConfirm}
            disabled={loading}
            className="gap-2 min-w-[80px]"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}
