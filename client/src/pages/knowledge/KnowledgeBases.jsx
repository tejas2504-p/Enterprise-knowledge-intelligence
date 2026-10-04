import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getKnowledgeBases, createKnowledgeBase } from '../../services/kbService';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Plus, Database, Loader2 } from 'lucide-react';

export default function KnowledgeBases() {
  const [kbs, setKbs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newKbData, setNewKbData] = useState({ name: '', description: '' });
  const [creating, setCreating] = useState(false);

  const fetchKbs = async () => {
    try {
      const data = await getKnowledgeBases();
      setKbs(data.data);
    } catch (error) {
      console.error('Failed to fetch knowledge bases', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKbs();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      await createKnowledgeBase(newKbData);
      setNewKbData({ name: '', description: '' });
      setIsModalOpen(false);
      fetchKbs();
    } catch (error) {
      console.error('Failed to create KB', error);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Knowledge Bases</h1>
          <p className="text-slate-500 mt-2">Manage your document collections for AI analysis.</p>
        </div>
        <Button onClick={() => setIsModalOpen(true)} className="gap-2">
          <Plus size={18} /> New Knowledge Base
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-primary-600" size={32} />
        </div>
      ) : kbs.length === 0 ? (
        <Card className="text-center py-16">
          <div className="flex justify-center mb-4">
            <div className="p-4 bg-primary-50 rounded-full">
              <Database className="text-primary-600" size={48} />
            </div>
          </div>
          <CardTitle className="text-xl mb-2">No Knowledge Bases Found</CardTitle>
          <CardDescription className="mb-6">
            Create your first knowledge base to start organizing documents.
          </CardDescription>
          <Button onClick={() => setIsModalOpen(true)}>Create Knowledge Base</Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {kbs.map((kb) => (
            <Link key={kb._id} to={`/knowledge/${kb._id}`}>
              <Card className="h-full hover:shadow-md transition-shadow cursor-pointer group hover:border-primary-200">
                <CardHeader>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-primary-50 text-primary-600 rounded-lg group-hover:bg-primary-100 transition-colors">
                      <Database size={20} />
                    </div>
                    <CardTitle className="text-lg truncate">{kb.name}</CardTitle>
                  </div>
                  <CardDescription className="line-clamp-2 mt-2">
                    {kb.description || 'No description provided.'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-xs text-slate-400 mt-4">
                    Created on {new Date(kb.createdAt).toLocaleDateString()}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md bg-white">
            <form onSubmit={handleCreate}>
              <CardHeader>
                <CardTitle>Create Knowledge Base</CardTitle>
                <CardDescription>Give your new document collection a name.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name</label>
                  <input
                    type="text"
                    required
                    className="w-full border-slate-200 rounded-md p-2 border focus:ring-2 focus:ring-primary-500 focus:outline-none"
                    value={newKbData.name}
                    onChange={(e) => setNewKbData({ ...newKbData, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <textarea
                    className="w-full border-slate-200 rounded-md p-2 border focus:ring-2 focus:ring-primary-500 focus:outline-none min-h-[100px]"
                    value={newKbData.description}
                    onChange={(e) => setNewKbData({ ...newKbData, description: e.target.value })}
                  />
                </div>
              </CardContent>
              <div className="p-6 pt-0 flex justify-end gap-3">
                <Button variant="ghost" onClick={() => setIsModalOpen(false)} type="button">
                  Cancel
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating ? <Loader2 className="animate-spin" size={18} /> : 'Create'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
