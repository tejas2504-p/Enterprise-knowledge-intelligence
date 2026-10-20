import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  getKnowledgeBases, 
  deleteKnowledgeBase 
} from '../../services/kbService';
import { Button } from '../../components/ui/Button';
import { 
  Plus, 
  Search, 
  Database, 
  LayoutGrid, 
  Table as TableIcon, 
  RefreshCw, 
  AlertCircle,
  Filter
} from 'lucide-react';
import KbCard from '../../components/knowledge/KbCard';
import KbTable from '../../components/knowledge/KbTable';
import { CardSkeleton, TableSkeleton } from '../../components/ui/LoadingState';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';

export default function KnowledgeBases() {
  const [kbs, setKbs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'table'

  // Delete modal state
  const [deletingKb, setDeletingKb] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const navigate = useNavigate();

  const fetchKbs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getKnowledgeBases();
      setKbs(data.data || []);
    } catch (err) {
      console.error('Failed to fetch knowledge bases', err);
      setError(err.response?.data?.message || 'Failed to load knowledge bases. Please check connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKbs();
  }, [fetchKbs]);

  // Client-side filtering for fast interactive search & filter
  const filteredKbs = useMemo(() => {
    return kbs.filter((kb) => {
      const matchesSearch =
        (kb.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (kb.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (kb.department || '').toLowerCase().includes(searchTerm.toLowerCase());

      const matchesVisibility =
        visibilityFilter === 'all' || kb.visibility === visibilityFilter;

      const matchesStatus =
        statusFilter === 'all' || kb.status === statusFilter;

      return matchesSearch && matchesVisibility && matchesStatus;
    });
  }, [kbs, searchTerm, visibilityFilter, statusFilter]);

  // Handle KB Deletion with Confirmation Modal
  const confirmDelete = async () => {
    if (!deletingKb) return;

    try {
      setIsDeleting(true);
      await deleteKnowledgeBase(deletingKb._id);
      setKbs((prev) => prev.filter((item) => item._id !== deletingKb._id));
      setDeletingKb(null);
    } catch (err) {
      console.error('Failed to delete knowledge base', err);
      alert(err.response?.data?.message || 'Failed to delete knowledge base');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Knowledge Bases
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage your enterprise document collections for AI ingestion, search, and assistant context.
          </p>
        </div>

        <Button
          onClick={() => navigate('/knowledge-bases/create')}
          className="gap-2 shrink-0 shadow-sm"
        >
          <Plus size={16} />
          <span>Create Knowledge Base</span>
        </Button>
      </div>

      {/* Search & Filters Toolbar */}
      <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <Search size={16} />
          </div>
          <input
            type="text"
            placeholder="Search by name, description, or department..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-primary-500 focus:outline-none shadow-sm transition-all"
          />
        </div>

        {/* Filters & View Toggle */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Visibility filter */}
          <div className="flex items-center gap-1.5 border border-slate-200 rounded-lg bg-white px-3 py-2 shadow-sm text-xs">
            <Filter size={14} className="text-slate-400 shrink-0" />
            <select
              value={visibilityFilter}
              onChange={(e) => setVisibilityFilter(e.target.value)}
              className="bg-transparent border-none focus:outline-none text-slate-700 font-medium cursor-pointer"
            >
              <option value="all">All Visibility</option>
              <option value="private">Private</option>
              <option value="department">Department</option>
              <option value="organization">Organization</option>
            </select>
          </div>

          {/* Status filter */}
          <div className="flex items-center border border-slate-200 rounded-lg bg-white px-3 py-2 shadow-sm text-xs">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent border-none focus:outline-none text-slate-700 font-medium cursor-pointer"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200 shadow-inner">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md transition-all ${
                viewMode === 'grid'
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              title="Grid View"
              aria-label="Grid View"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-md transition-all ${
                viewMode === 'table'
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              title="Table View"
              aria-label="Table View"
            >
              <TableIcon size={16} />
            </button>
          </div>

          {/* Refresh Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={fetchKbs}
            className="h-9 px-2.5 text-slate-600"
            title="Refresh Knowledge Bases"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>

      {/* Content Area */}
      {loading ? (
        viewMode === 'grid' ? <CardSkeleton count={6} /> : <TableSkeleton rows={5} cols={7} />
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center max-w-lg mx-auto">
          <AlertCircle size={40} className="text-red-500 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-red-900 mb-1">
            Unable to load Knowledge Bases
          </h3>
          <p className="text-xs text-red-600 mb-4">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchKbs} className="gap-2">
            <RefreshCw size={14} /> Try Again
          </Button>
        </div>
      ) : kbs.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No Knowledge Bases created yet"
          description="Knowledge Bases allow your team to organize collections of documents for AI assistance and intelligent search."
          actionLabel="Create Knowledge Base"
          onAction={() => navigate('/knowledge-bases/create')}
        />
      ) : filteredKbs.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matching Knowledge Bases"
          description={`No collections matched "${searchTerm}" with the active filters.`}
          actionLabel="Clear Filters"
          onAction={() => {
            setSearchTerm('');
            setVisibilityFilter('all');
            setStatusFilter('all');
          }}
        />
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredKbs.map((kb) => (
            <KbCard
              key={kb._id}
              kb={kb}
              onDelete={(targetKb) => setDeletingKb(targetKb)}
            />
          ))}
        </div>
      ) : (
        <KbTable
          kbs={filteredKbs}
          onDelete={(targetKb) => setDeletingKb(targetKb)}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={Boolean(deletingKb)}
        onClose={() => setDeletingKb(null)}
        onConfirm={confirmDelete}
        title={`Delete "${deletingKb?.name}"?`}
        description="Are you sure you want to permanently delete this knowledge base? All associated documents and vector index data will be removed. This action cannot be undone."
        confirmText="Delete Knowledge Base"
        cancelText="Cancel"
        variant="destructive"
        loading={isDeleting}
      />
    </div>
  );
}
