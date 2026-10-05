import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getKnowledgeBase, updateKnowledgeBase, deleteKnowledgeBase } from '../../services/kbService';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Loader2, ArrowLeft, Trash2, AlertCircle } from 'lucide-react';

export default function KnowledgeBaseSettings() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    department: '',
    visibility: 'private',
    status: 'active'
  });
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchKb = async () => {
      try {
        const kbData = await getKnowledgeBase(id);
        const kb = kbData.data;
        setFormData({
          name: kb.name || '',
          description: kb.description || '',
          department: kb.department || '',
          visibility: kb.visibility || 'private',
          status: kb.status || 'active'
        });
      } catch (err) {
        setError('Failed to load knowledge base settings');
      } finally {
        setLoading(false);
      }
    };
    fetchKb();
  }, [id]);

  const handleUpdate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateKnowledgeBase(id, formData);
      navigate(`/knowledge-bases/${id}`);
    } catch (err) {
      console.error('Update failed', err);
      alert('Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this knowledge base? This action cannot be undone.')) {
      return;
    }
    setDeleting(true);
    try {
      await deleteKnowledgeBase(id);
      navigate('/knowledge-bases');
    } catch (err) {
      console.error('Delete failed', err);
      alert('Failed to delete knowledge base');
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-[50vh]">
        <Loader2 className="animate-spin text-primary-600" size={40} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 max-w-7xl mx-auto text-center">
        <AlertCircle className="mx-auto text-red-500 mb-4" size={48} />
        <h2 className="text-2xl font-bold mb-4">{error}</h2>
        <Button onClick={() => navigate('/knowledge-bases')}>Go Back</Button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <Button variant="ghost" onClick={() => navigate(`/knowledge-bases/${id}`)} className="mb-6 gap-2 -ml-4">
        <ArrowLeft size={16} /> Back to Knowledge Base
      </Button>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-500 mt-2">Manage settings for this knowledge base.</p>
      </div>

      <Card className="mb-8">
        <form onSubmit={handleUpdate}>
          <CardHeader>
            <CardTitle>General Information</CardTitle>
            <CardDescription>Update name, description, and visibility.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <input
                type="text"
                required
                className="w-full border-slate-200 rounded-md p-2 border focus:ring-2 focus:ring-primary-500 focus:outline-none"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <textarea
                className="w-full border-slate-200 rounded-md p-2 border focus:ring-2 focus:ring-primary-500 focus:outline-none min-h-[100px]"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium">Department</label>
                <input
                  type="text"
                  className="w-full border-slate-200 rounded-md p-2 border focus:ring-2 focus:ring-primary-500 focus:outline-none"
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Visibility</label>
                <select
                  className="w-full border-slate-200 rounded-md p-2 border bg-white focus:ring-2 focus:ring-primary-500 focus:outline-none"
                  value={formData.visibility}
                  onChange={(e) => setFormData({ ...formData, visibility: e.target.value })}
                >
                  <option value="private">Private (Only You)</option>
                  <option value="department">Department</option>
                  <option value="organization">Organization</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <select
                  className="w-full border-slate-200 rounded-md p-2 border bg-white focus:ring-2 focus:ring-primary-500 focus:outline-none"
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                >
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>
          </CardContent>
          <div className="p-6 pt-0 flex justify-end gap-3 border-t border-slate-100 mt-6">
            <Button variant="ghost" onClick={() => navigate(`/knowledge-bases/${id}`)} type="button">
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" size={18} /> : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="text-red-600">Danger Zone</CardTitle>
          <CardDescription>Permanently delete this knowledge base and all of its contents.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500 mb-4">
            Once you delete a knowledge base, there is no going back. Please be certain.
          </p>
          <Button 
            variant="ghost" 
            className="text-red-600 bg-red-50 hover:bg-red-100 hover:text-red-700 w-full md:w-auto"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? <Loader2 className="animate-spin mr-2" size={16} /> : <Trash2 className="mr-2" size={16} />}
            Delete Knowledge Base
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
