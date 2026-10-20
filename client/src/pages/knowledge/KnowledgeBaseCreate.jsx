import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createKnowledgeBase } from '../../services/kbService';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { ArrowLeft, Loader2, Database, Shield, Users, Building2, AlertCircle } from 'lucide-react';

export default function KnowledgeBaseCreate() {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    department: '',
    visibility: 'private',
  });

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError('Please provide a knowledge base name');
      return;
    }

    setCreating(true);
    setError('');

    try {
      const response = await createKnowledgeBase({
        name: formData.name.trim(),
        description: formData.description.trim(),
        department: formData.department.trim() || undefined,
        visibility: formData.visibility,
      });

      // Navigate to the newly created KB detail page
      navigate(`/knowledge-bases/${response.data._id}`);
    } catch (err) {
      console.error('Failed to create KB', err);
      setError(
        err.response?.data?.message ||
        'Failed to create knowledge base. Please check input values.'
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back Button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate('/knowledge-bases')}
        className="gap-2 -ml-2 text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft size={16} />
        <span>Back to Knowledge Bases</span>
      </Button>

      <Card className="border-slate-200 shadow-soft bg-white">
        <form onSubmit={handleCreate}>
          <CardHeader className="border-b border-slate-100 pb-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-primary-50 text-primary-600 rounded-lg">
                <Database size={22} />
              </div>
              <div>
                <CardTitle className="text-xl font-bold text-slate-900">
                  Create Knowledge Base
                </CardTitle>
                <CardDescription className="text-xs text-slate-500 mt-1">
                  Organize documents into a centralized, searchable intelligence space for your enterprise.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-6 space-y-5">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg border border-red-200 text-xs">
                <AlertCircle size={16} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}

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
                placeholder="e.g., Engineering Handbook, HR Policies, Product Specs"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 bg-white focus:ring-2 focus:ring-primary-500 focus:outline-none transition-all placeholder:text-slate-400"
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
                placeholder="Briefly describe what documents and domains this knowledge base covers..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full text-sm border border-slate-200 rounded-lg p-3 bg-white focus:ring-2 focus:ring-primary-500 focus:outline-none transition-all placeholder:text-slate-400 min-h-[90px]"
              />
            </div>

            {/* Department */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                Department
              </label>
              <input
                type="text"
                placeholder="e.g., Engineering, Legal, Operations, Finance"
                value={formData.department}
                onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 bg-white focus:ring-2 focus:ring-primary-500 focus:outline-none transition-all placeholder:text-slate-400"
              />
              <p className="text-[11px] text-slate-400">
                Optional: helps categorize knowledge bases by functional teams.
              </p>
            </div>

            {/* Visibility Option Cards */}
            <div className="space-y-2 pt-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                Visibility & Access Scope
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Private */}
                <div
                  onClick={() => setFormData({ ...formData, visibility: 'private' })}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                    formData.visibility === 'private'
                      ? 'border-primary-500 bg-primary-50/40 ring-1 ring-primary-500'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Shield size={16} className={formData.visibility === 'private' ? 'text-primary-600' : 'text-slate-400'} />
                    <span className="text-xs font-semibold text-slate-900">Private</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-snug">
                    Restricted strictly to you and platform administrators.
                  </p>
                </div>

                {/* Department */}
                <div
                  onClick={() => setFormData({ ...formData, visibility: 'department' })}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                    formData.visibility === 'department'
                      ? 'border-primary-500 bg-primary-50/40 ring-1 ring-primary-500'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Users size={16} className={formData.visibility === 'department' ? 'text-primary-600' : 'text-slate-400'} />
                    <span className="text-xs font-semibold text-slate-900">Department</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-snug">
                    Accessible to all colleagues inside your department.
                  </p>
                </div>

                {/* Organization */}
                <div
                  onClick={() => setFormData({ ...formData, visibility: 'organization' })}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                    formData.visibility === 'organization'
                      ? 'border-primary-500 bg-primary-50/40 ring-1 ring-primary-500'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Building2 size={16} className={formData.visibility === 'organization' ? 'text-primary-600' : 'text-slate-400'} />
                    <span className="text-xs font-semibold text-slate-900">Organization</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-snug">
                    Visible to all authenticated enterprise employees.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>

          {/* Form Actions */}
          <div className="p-6 bg-slate-50/60 border-t border-slate-100 flex items-center justify-end gap-3 rounded-b-lg">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate('/knowledge-bases')}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={creating}
              className="gap-2 min-w-[130px]"
            >
              {creating ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  <span>Creating...</span>
                </>
              ) : (
                <span>Create Knowledge Base</span>
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
