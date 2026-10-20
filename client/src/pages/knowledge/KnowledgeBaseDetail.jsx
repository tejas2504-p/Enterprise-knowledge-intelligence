import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getKnowledgeBase } from '../../services/kbService';
import { 
  getDocuments, 
  uploadDocument, 
  deleteDocument 
} from '../../services/docService';
import { Button } from '../../components/ui/Button';
import { 
  ArrowLeft, 
  Settings, 
  Database, 
  Upload, 
  AlertCircle, 
  RefreshCw,
  FolderOpen
} from 'lucide-react';
import { VisibilityBadge, StatusBadge } from '../../components/ui/Badge';
import KbStats from '../../components/knowledge/KbStats';
import DocumentUploadZone from '../../components/knowledge/DocumentUploadZone';
import DocumentTable from '../../components/knowledge/DocumentTable';
import DocumentDetailModal from '../../components/knowledge/DocumentDetailModal';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { LoadingSpinner } from '../../components/ui/LoadingState';

export default function KnowledgeBaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [kb, setKb] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  // Document details modal
  const [selectedDocForDetails, setSelectedDocForDetails] = useState(null);

  // Deletion modals state
  const [docToDelete, setDocToDelete] = useState(null);
  const [bulkDeleteIds, setBulkDeleteIds] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch KB and associated documents
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [kbRes, docsRes] = await Promise.all([
        getKnowledgeBase(id),
        getDocuments(id),
      ]);
      setKb(kbRes.data);
      setDocuments(docsRes.data || []);
    } catch (err) {
      console.error('Failed to load knowledge base details', err);
      setError(err.response?.data?.message || 'Knowledge Base not found or access denied.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle uploading multiple files
  const handleUploadFiles = async (files) => {
    if (!files || files.length === 0) return;

    setUploading(true);
    let successCount = 0;
    const errors = [];

    for (let i = 0; i < files.length; i++) {
      try {
        await uploadDocument(id, files[i]);
        successCount++;
      } catch (err) {
        console.error('Upload failed for file', files[i].name, err);
        errors.push(`${files[i].name}: ${err.response?.data?.message || err.message}`);
      }
    }

    setUploading(false);

    if (errors.length > 0) {
      alert(`Uploaded ${successCount}/${files.length} files. Errors:\n` + errors.join('\n'));
    }

    // Refresh KB metadata and document list
    fetchData();
  };

  // Single document deletion
  const confirmDeleteDoc = async () => {
    if (!docToDelete) return;

    try {
      setIsDeleting(true);
      await deleteDocument(docToDelete._id);
      setDocuments((prev) => prev.filter((d) => d._id !== docToDelete._id));
      setDocToDelete(null);
      if (selectedDocForDetails?._id === docToDelete._id) {
        setSelectedDocForDetails(null);
      }
      // Silently refresh stats
      getKnowledgeBase(id).then((res) => setKb(res.data)).catch(() => {});
    } catch (err) {
      console.error('Failed to delete document', err);
      alert(err.response?.data?.message || 'Failed to delete document');
    } finally {
      setIsDeleting(false);
    }
  };

  // Bulk document deletion
  const confirmBulkDelete = async () => {
    if (!bulkDeleteIds || bulkDeleteIds.length === 0) return;

    try {
      setIsDeleting(true);
      for (const docId of bulkDeleteIds) {
        try {
          await deleteDocument(docId);
        } catch (e) {
          console.error('Failed to delete docId', docId, e);
        }
      }
      setDocuments((prev) => prev.filter((d) => !bulkDeleteIds.includes(d._id)));
      setBulkDeleteIds(null);
      // Silently refresh stats
      getKnowledgeBase(id).then((res) => setKb(res.data)).catch(() => {});
    } catch (err) {
      console.error('Bulk delete failure', err);
      alert('Encountered an issue deleting some documents');
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message="Loading knowledge base details..." />;
  }

  if (error || !kb) {
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-4">
        <div className="p-4 bg-red-50 text-red-600 rounded-full w-16 h-16 mx-auto flex items-center justify-center">
          <AlertCircle size={32} />
        </div>
        <h2 className="text-xl font-bold text-slate-900">
          Knowledge Base Not Found
        </h2>
        <p className="text-sm text-slate-500">
          {error || 'The requested knowledge base does not exist or you do not have permission to view it.'}
        </p>
        <Button onClick={() => navigate('/knowledge-bases')} className="gap-2">
          <ArrowLeft size={16} /> Return to Knowledge Bases
        </Button>
      </div>
    );
  }

  const isArchived = kb.status === 'archived';

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Top Navigation & Breadcrumbs */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/knowledge-bases')}
          className="gap-2 -ml-2 text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft size={16} />
          <span>Back to Knowledge Bases</span>
        </Button>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchData}
            title="Refresh Knowledge Base"
            className="text-slate-600"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </Button>

          <Link to={`/knowledge-bases/${id}/settings`}>
            <Button variant="outline" size="sm" className="gap-2 text-slate-700">
              <Settings size={15} />
              <span>Settings</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Main Header Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="p-3.5 bg-primary-50 text-primary-600 rounded-xl hidden sm:flex shrink-0">
              <Database size={32} />
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                  {kb.name}
                </h1>
                <StatusBadge status={kb.status} />
                <VisibilityBadge visibility={kb.visibility} />
              </div>

              <p className="text-sm text-slate-500 max-w-3xl leading-relaxed">
                {kb.description || 'No description provided for this collection.'}
              </p>

              {/* Owner meta */}
              <div className="flex items-center gap-3 text-xs text-slate-400 pt-1">
                <span>Owner: <strong className="text-slate-700 font-medium">{kb.owner?.name || 'Administrator'}</strong></span>
                {kb.department && (
                  <>
                    <span>•</span>
                    <span>Department: <strong className="text-slate-700 font-medium">{kb.department}</strong></span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Statistics Section */}
      <KbStats kb={kb} />

      {/* Drag & Drop Upload Zone */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Upload size={18} className="text-primary-600" />
            <span>Upload New Documents</span>
          </h2>
        </div>

        <DocumentUploadZone
          onUpload={handleUploadFiles}
          uploading={uploading}
          isArchived={isArchived}
        />
      </div>

      {/* Documents Section */}
      <DocumentTable
        documents={documents}
        onSelectDoc={(doc) => setSelectedDocForDetails(doc)}
        onDeleteDoc={(doc) => setDocToDelete(doc)}
        onDeleteSelected={(ids) => setBulkDeleteIds(ids)}
        isArchived={isArchived}
      />

      {/* Document Details Modal */}
      <DocumentDetailModal
        doc={selectedDocForDetails}
        isOpen={Boolean(selectedDocForDetails)}
        onClose={() => setSelectedDocForDetails(null)}
        onDelete={(doc) => {
          setSelectedDocForDetails(null);
          setDocToDelete(doc);
        }}
        isArchived={isArchived}
      />

      {/* Single Document Deletion Confirmation */}
      <ConfirmationDialog
        isOpen={Boolean(docToDelete)}
        onClose={() => setDocToDelete(null)}
        onConfirm={confirmDeleteDoc}
        title={`Delete "${docToDelete?.title || docToDelete?.originalFileName}"?`}
        description="Are you sure you want to permanently delete this document? Extracted text and indexed chunks will be purged. This action cannot be undone."
        confirmText="Delete Document"
        variant="destructive"
        loading={isDeleting}
      />

      {/* Bulk Document Deletion Confirmation */}
      <ConfirmationDialog
        isOpen={Boolean(bulkDeleteIds && bulkDeleteIds.length > 0)}
        onClose={() => setBulkDeleteIds(null)}
        onConfirm={confirmBulkDelete}
        title={`Delete ${bulkDeleteIds?.length} Documents?`}
        description={`Are you sure you want to delete these ${bulkDeleteIds?.length} selected documents? All indexed vector embeddings will be permanently removed.`}
        confirmText="Delete Selected"
        variant="destructive"
        loading={isDeleting}
      />
    </div>
  );
}
