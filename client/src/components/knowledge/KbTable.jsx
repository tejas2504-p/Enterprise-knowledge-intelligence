import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Database, FileText } from 'lucide-react';
import { VisibilityBadge, StatusBadge } from '../ui/Badge';
import { formatBytes, formatDate } from '../../utils/formatters';
import KbActionsMenu from './KbActionsMenu';

export default function KbTable({ kbs = [], onDelete }) {
  const navigate = useNavigate();

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-500 uppercase tracking-wider text-xs font-semibold">
            <tr>
              <th className="px-6 py-3.5">Knowledge Base</th>
              <th className="px-6 py-3.5">Owner</th>
              <th className="px-6 py-3.5">Visibility</th>
              <th className="px-6 py-3.5">Status</th>
              <th className="px-6 py-3.5">Documents</th>
              <th className="px-6 py-3.5">Last Updated</th>
              <th className="px-6 py-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {kbs.map((kb) => {
              const ownerName = kb.owner?.name || (typeof kb.owner === 'string' ? 'Owner' : 'Unknown');
              const ownerInitial = ownerName.charAt(0).toUpperCase();

              return (
                <tr
                  key={kb._id}
                  onClick={() => navigate(`/knowledge-bases/${kb._id}`)}
                  className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                >
                  {/* Name and description */}
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary-50 text-primary-600 rounded-lg group-hover:bg-primary-600 group-hover:text-white transition-colors shrink-0">
                        <Database size={18} />
                      </div>
                      <div className="max-w-xs md:max-w-sm truncate">
                        <Link
                          to={`/knowledge-bases/${kb._id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-semibold text-slate-900 hover:text-primary-600 transition-colors block truncate"
                        >
                          {kb.name}
                        </Link>
                        {kb.description ? (
                          <p className="text-xs text-slate-400 truncate mt-0.5">
                            {kb.description}
                          </p>
                        ) : (
                          <span className="text-xs text-slate-400 italic">No description</span>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Owner */}
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-xs font-medium text-slate-700 shrink-0">
                        {ownerInitial}
                      </div>
                      <span className="text-slate-700 text-xs font-medium truncate max-w-[120px]">
                        {ownerName}
                      </span>
                    </div>
                  </td>

                  {/* Visibility */}
                  <td className="px-6 py-4">
                    <VisibilityBadge visibility={kb.visibility} />
                  </td>

                  {/* Status */}
                  <td className="px-6 py-4">
                    <StatusBadge status={kb.status} />
                  </td>

                  {/* Documents & size */}
                  <td className="px-6 py-4">
                    <div className="text-xs">
                      <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                        <FileText size={13} className="text-slate-400" />
                        <span>{kb.documentCount || 0}</span>
                      </div>
                      <div className="text-slate-400 text-[11px] mt-0.5">
                        {formatBytes(kb.totalSize || 0)}
                      </div>
                    </div>
                  </td>

                  {/* Last updated */}
                  <td className="px-6 py-4 text-xs text-slate-500">
                    {formatDate(kb.updatedAt || kb.createdAt)}
                  </td>

                  {/* Actions */}
                  <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <KbActionsMenu kb={kb} onDelete={onDelete} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
