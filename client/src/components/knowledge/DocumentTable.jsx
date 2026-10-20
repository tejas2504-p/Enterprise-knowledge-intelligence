import React, { useState, useMemo } from 'react';
import { 
  FileText, 
  Search, 
  Filter, 
  Trash2, 
  Info, 
  File, 
  CheckSquare, 
  Square 
} from 'lucide-react';
import { Button } from '../ui/Button';
import { ProcessingStatusBadge } from '../ui/Badge';
import { formatBytes, formatDate, formatNumber } from '../../utils/formatters';
import { EmptyState } from '../ui/EmptyState';

export default function DocumentTable({
  documents = [],
  onSelectDoc,
  onDeleteDoc,
  onDeleteSelected,
  isArchived = false,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Filter documents based on search and status
  const filteredDocs = useMemo(() => {
    return documents.filter((doc) => {
      const titleMatch = (doc.title || doc.originalFileName || '')
        .toLowerCase()
        .includes(searchTerm.toLowerCase());
      const statusMatch = statusFilter === 'all' || doc.processingStatus === statusFilter;
      return titleMatch && statusMatch;
    });
  }, [documents, searchTerm, statusFilter]);

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredDocs.length && filteredDocs.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredDocs.map((d) => d._id)));
    }
  };

  const toggleSelectDoc = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleBulkDelete = () => {
    if (onDeleteSelected && selectedIds.size > 0) {
      onDeleteSelected(Array.from(selectedIds));
      setSelectedIds(new Set());
    }
  };

  const isAllSelected = filteredDocs.length > 0 && selectedIds.size === filteredDocs.length;

  return (
    <div className="space-y-4">
      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <span>Documents</span>
            <span className="bg-slate-100 text-slate-600 text-xs py-0.5 px-2.5 rounded-full font-medium">
              {documents.length}
            </span>
          </h2>

          {selectedIds.size > 0 && !isArchived && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleBulkDelete}
              className="gap-1.5 h-8 ml-2 text-xs"
            >
              <Trash2 size={13} />
              <span>Delete ({selectedIds.size})</span>
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
          {/* Status Filter */}
          <div className="flex items-center gap-1.5 border border-slate-200 rounded-md bg-white px-2.5 py-1.5 shadow-sm text-xs">
            <Filter size={14} className="text-slate-400 shrink-0" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent border-none focus:outline-none text-slate-700 font-medium cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="uploaded">Uploaded</option>
              <option value="processing">Processing</option>
              <option value="processed">Processed</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          {/* Search Box */}
          <div className="relative flex-1 sm:w-64">
            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
              <Search size={14} className="text-slate-400" />
            </div>
            <input
              type="text"
              placeholder="Search documents..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-md bg-white focus:ring-2 focus:ring-primary-500 focus:outline-none shadow-sm placeholder:text-slate-400"
            />
          </div>
        </div>
      </div>

      {/* Table / Empty State */}
      {documents.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents yet"
          description="Upload files to start building this knowledge base. Drag and drop your files or browse above."
        />
      ) : filteredDocs.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No documents matched"
          description={`No documents match the search criteria "${searchTerm}". Try resetting your search or filter.`}
          actionLabel="Clear Filter"
          actionIcon={Filter}
          onAction={() => {
            setSearchTerm('');
            setStatusFilter('all');
          }}
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left whitespace-nowrap">
              <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[11px]">
                <tr>
                  {!isArchived && (
                    <th className="px-4 py-3.5 w-10">
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={toggleSelectAll}
                        className="rounded border-slate-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                        aria-label="Select all documents"
                      />
                    </th>
                  )}
                  <th className="px-5 py-3.5">Document Name</th>
                  <th className="px-4 py-3.5">Type</th>
                  <th className="px-4 py-3.5">Size</th>
                  <th className="px-4 py-3.5">Uploaded By</th>
                  <th className="px-4 py-3.5">Date</th>
                  <th className="px-4 py-3.5">Words</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDocs.map((doc) => {
                  const isSelected = selectedIds.has(doc._id);

                  return (
                    <tr
                      key={doc._id}
                      onClick={() => onSelectDoc && onSelectDoc(doc)}
                      className={`hover:bg-slate-50/80 transition-colors group cursor-pointer ${
                        isSelected ? 'bg-primary-50/40' : ''
                      }`}
                    >
                      {!isArchived && (
                        <td
                          className="px-4 py-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectDoc(doc._id)}
                            className="rounded border-slate-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                            aria-label={`Select document ${doc.title || doc.originalFileName}`}
                          />
                        </td>
                      )}

                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5 max-w-xs md:max-w-sm">
                          <File size={16} className="text-primary-500 shrink-0" />
                          <span
                            className="font-semibold text-slate-900 truncate"
                            title={doc.title || doc.originalFileName}
                          >
                            {doc.title || doc.originalFileName}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3 uppercase text-slate-500 font-medium text-[11px]">
                        {doc.fileType || 'FILE'}
                      </td>

                      <td className="px-4 py-3 text-slate-500">
                        {formatBytes(doc.fileSize || 0)}
                      </td>

                      <td className="px-4 py-3 text-slate-600 truncate max-w-[120px]">
                        {doc.uploadedBy?.name || 'Current User'}
                      </td>

                      <td className="px-4 py-3 text-slate-500">
                        {formatDate(doc.createdAt)}
                      </td>

                      <td className="px-4 py-3 text-slate-600 font-mono">
                        {formatNumber(doc.wordCount)}
                      </td>

                      <td className="px-4 py-3">
                        <ProcessingStatusBadge status={doc.processingStatus} />
                      </td>

                      <td
                        className="px-4 py-3 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onSelectDoc && onSelectDoc(doc)}
                            className="h-7 w-7 text-slate-400 hover:text-primary-600"
                            title="View Document Details"
                          >
                            <Info size={14} />
                          </Button>

                          {!isArchived && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => onDeleteDoc && onDeleteDoc(doc)}
                              className="h-7 w-7 text-slate-400 hover:text-red-600"
                              title="Delete Document"
                            >
                              <Trash2 size={14} />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
