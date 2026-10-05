import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createKnowledgeBase } from '../../services/kbService';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Loader2, ArrowLeft } from 'lucide-react';

export default function KnowledgeBaseCreate() {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    department: '',
    visibility: 'private'
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    setError('');
    
    try {
      const response = await createKnowledgeBase(formData);
      navigate(`/knowledge-bases/${response.data._id}`);
    } catch (err) {
      console.error('Failed to create KB', err);
      setError(err.response?.data?.message || 'Failed to create knowledge base');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <Button variant="ghost" onClick={() => navigate('/knowledge-bases')} className="mb-6 gap-2 -ml-4">
        <ArrowLeft size={16} /> Back to Knowledge Bases
      </Button>

      <Card>
        <form onSubmit={handleCreate}>
          <CardHeader>
            <CardTitle>Create Knowledge Base</CardTitle>
            <CardDescription>Setup a new collection for your documents.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {error && (
              <div className="p-3 bg-red-50 text-red-700 rounded-md text-sm">
                {error}
              </div>
            )}
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Name <span className="text-red-500">*</span></label>
              <input
                type="text"
                required
                placeholder="e.g., HR Policies, Engineering Docs"
                className="w-full border-slate-200 rounded-md p-2 border focus:ring-2 focus:ring-primary-500 focus:outline-none"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <textarea
                placeholder="Briefly describe what this knowledge base contains..."
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
                  placeholder="e.g., Engineering, Marketing"
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
            </div>
          </CardContent>
          <div className="p-6 pt-0 flex justify-end gap-3 border-t border-slate-100 mt-6">
            <Button variant="ghost" onClick={() => navigate('/knowledge-bases')} type="button">
              Cancel
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? <Loader2 className="animate-spin" size={18} /> : 'Create Knowledge Base'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
