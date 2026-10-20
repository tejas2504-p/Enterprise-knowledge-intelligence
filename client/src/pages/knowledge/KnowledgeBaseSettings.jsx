import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  getKnowledgeBase, 
  updateKnowledgeBase, 
  deleteKnowledgeBase 
} from '../../services/kbService';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { 
  ArrowLeft, 
  Loader2, 
  Trash2, 
  AlertCircle, 
  CheckCircle2, 
  Save, 
  Settings,
  ShieldAlert
} from 'lucide-react';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { LoadingSpinner } from '../../components/ui/LoadingState';

export default function KnowledgeBaseSettings() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    department: '',
    visibility: 'private',
    status: 'active',
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const fetchKb = async () => {
      try {
        setLoading(true);
        setError(null);
        const kbData = await getKnowledgeBase(id);
        const kb = kbData.data;
        setFormData({
          name: kb.name || '',
          description: kb.description || '',
          department: kb.department || '',
          visibility: kb.visibility || 'private',
          status: kb.status || 'active',
        });
      } catch (err) {
        console.error('Failed to load settings', err);
        setError(err.response?.data?.message || 'Failed to load knowledge base settings');
      } finally {
        setLoading(false);
      }
    };
    fetchKb();
  }, [id]);

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError('Knowledge base name cannot be empty');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMessage('');

    try {
      await updateKnowledgeBase(id, {
        name: formData.name.trim(),
        description: formData.description.trim(),
        department: formData.department.trim() || null,
        visibility: formData.visibility,
        status: formData.status,
      });

      setSuccessMessage('Knowledge Base settings updated successfully.');
      setTimeout(() => {
        setSuccessMessage('');
      }, 4000);
    } catch (err) {
      console.error('Update failed', err);
      setError(err.response?.data?.message || 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteKnowledgeBase(id);
      navigate('/knowledge-bases');
    } catch (err) {
      console.error('Delete failed', err);
      alert(err.response?.data?.message || 'Failed to delete knowledge base');
      setDeleting(false);
      setShowDeleteModal(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message="Loading knowledge base settings..." />;
  }

  if (error && !formData.name) {
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-4">
        <AlertCircle size={40} className="text-red-500 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900">
          Settings Unavailable
        </h2>
        <p className="text-sm text-slate-500">{error}</p>
        <Button onClick={() => navigate('/knowledge-bases')} className="gap-2">
          <ArrowLeft size={16} /> Return to Knowledge Bases
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back Button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(`/knowledge-bases/${id}`)}
        className="gap-2 -ml-2 text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft size={16} />
        <span>Back to Knowledge Base</span>
      </Button>

      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
          <Settings size={28} className="text-slate-700" />
          <span>Knowledge Base Settings</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Configure collection details, accessibility scope, lifecycle status, or delete the collection.
        </p>
      </div>

      {/* Feedback Alerts */}
      {successMessage && (
        <div className="flex items-center gap-2.5 p-3.5 bg-emerald-50 text-emerald-800 rounded-xl border border-emerald-200 text-xs">
          <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2.5 p-3.5 bg-red-50 text-red-800 rounded-xl border border-red-200 text-xs">
          <AlertCircle size={16} className="text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Settings Form Card */}
      <Card className="border-slate-200 shadow-soft bg-white">
        <form onSubmit={handleUpdate}>
          <CardHeader className="border-b border-slate-100 pb-5">
            <CardTitle className="text-base font-semibold text-slate-900">
              General Configuration
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Update name, description, visibility, and active status.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-6 space-y-5">
            {/* Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-700 flex justify-between">
                <span>Knowledge Base Name <span className="text-red-500">*</span></span>
                <span className="text-slate-400 font-normal normal-case">{formData.name.length}/100</span>
              </label>
              <input
                type="text"
                required
                maxLength={100}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 bg-white focus:ring-2 focus:ring-primary-500 focus:outline-none transition-all"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-700 flex justify-between">
                <span>Description</span>
                <span className="text-slate-400 font-normal normal-case">{formData.description.length}/500</span>
              </label>
              <textarea
                maxLength={500}
                className="w-full text-sm border border-slate-200 rounded-lg p-3 bg-white focus:ring-2 focus:ring-primary-500 focus:outline-none transition-all min-h-[90px]"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            {/* Department, Visibility & Status */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Department
                </label>
                <input
                  type="text"
                  placeholder="e.g., Engineering"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-primary-500 focus:outline-none"
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Visibility
                </label>
                <select
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-primary-500 focus:outline-none cursor-pointer"
                  value={formData.visibility}
                  onChange={(e) => setFormData({ ...formData, visibility: e.target.value })}
                >
                  <option value="private">Private (Only You)</option>
                  <option value="department">Department</option>
                  <option value="organization">Organization</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Lifecycle Status
                </label>
                <select
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-primary-500 focus:outline-none cursor-pointer"
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                >
                  <option value="active">Active</option>
                  <option value="archived">Archived (Read-Only)</option>
                </select>
              </div>
            </div>
          </CardContent>

          {/* Form Actions */}
          <div className="p-6 bg-slate-50/60 border-t border-slate-100 flex items-center justify-between rounded-b-lg">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate(`/knowledge-bases/${id}`)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={saving}
              className="gap-2 min-w-[120px]"
            >
              {saving ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save size={15} />
                  <span>Save Changes</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </Card>

      {/* Danger Zone */}
      <Card className="border-red-200/80 bg-red-50/20 shadow-sm">
        <CardHeader className="border-b border-red-100 pb-4">
          <div className="flex items-center gap-2 text-red-600">
            <ShieldAlert size={20} />
            <CardTitle className="text-base font-semibold text-red-700">
              Danger Zone
            </CardTitle>
          </div>
          <CardDescription className="text-xs text-red-600/80">
            Irreversible actions regarding this Knowledge Base.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-semibold text-slate-900">
                Delete Knowledge Base
              </h4>
              <p className="text-xs text-slate-500 mt-0.5 max-w-md">
                Permanently deletes the knowledge base, all contained documents, metadata, and AI vector indices.
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteModal(true)}
              className="shrink-0 gap-2"
            >
              <Trash2 size={14} />
              <span>Delete Knowledge Base</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Modal */}
      <ConfirmationDialog
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title={`Delete "${formData.name}"?`}
        description="Are you certain you want to permanently delete this knowledge base? This action is irreversible and all document embeddings will be wiped immediately."
        confirmText="Yes, Delete Permanently"
        variant="destructive"
        loading={deleting}
      />
    </div>
  );
}
