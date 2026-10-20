import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreVertical, Settings, Trash2, Eye } from 'lucide-react';

export default function KbActionsMenu({ kb, onDelete }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors focus:outline-none"
        aria-label="Knowledge Base actions"
      >
        <MoreVertical size={17} />
      </button>

      {isOpen && (
        <div 
          className="absolute right-0 mt-1 w-44 rounded-lg bg-white shadow-lg border border-slate-200 py-1 z-30 animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              navigate(`/knowledge-bases/${kb._id}`);
            }}
            className="w-full text-left px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors"
          >
            <Eye size={14} className="text-slate-400" />
            <span>View Details</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              navigate(`/knowledge-bases/${kb._id}/settings`);
            }}
            className="w-full text-left px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 transition-colors"
          >
            <Settings size={14} className="text-slate-400" />
            <span>Settings</span>
          </button>

          <div className="border-t border-slate-100 my-1" />

          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              if (onDelete) onDelete(kb);
            }}
            className="w-full text-left px-3.5 py-2 text-xs font-medium text-red-600 hover:bg-red-50 flex items-center gap-2.5 transition-colors"
          >
            <Trash2 size={14} className="text-red-500" />
            <span>Delete</span>
          </button>
        </div>
      )}
    </div>
  );
}
