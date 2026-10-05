import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getKnowledgeBases } from '../../services/kbService';
import { Card, CardTitle, CardDescription } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Plus, Database, Loader2, Search } from 'lucide-react';
import KbCard from '../../components/knowledge/KbCard';

export default function KnowledgeBases() {
  const [kbs, setKbs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

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

  const filteredKbs = kbs.filter(kb => 
    kb.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (kb.description && kb.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Knowledge Bases</h1>
          <p className="text-slate-500 mt-2">Manage your document collections for AI analysis.</p>
        </div>
        <div className="flex gap-4 w-full md:w-auto">
          <div className="relative flex-grow md:flex-grow-0 md:w-64">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search size={16} className="text-slate-400" />
            </div>
            <input
              type="text"
              placeholder="Search knowledge bases..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-md focus:ring-2 focus:ring-primary-500 focus:outline-none"
            />
          </div>
          <Button onClick={() => navigate('/knowledge-bases/create')} className="gap-2 shrink-0">
            <Plus size={18} /> New Knowledge Base
          </Button>
        </div>
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
          <Button onClick={() => navigate('/knowledge-bases/create')}>Create Knowledge Base</Button>
        </Card>
      ) : filteredKbs.length === 0 ? (
        <Card className="text-center py-16">
          <CardTitle className="text-xl mb-2">No results found</CardTitle>
          <CardDescription>
            No knowledge bases matched your search criteria.
          </CardDescription>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredKbs.map((kb) => (
            <KbCard key={kb._id} kb={kb} />
          ))}
        </div>
      )}
    </div>
  );
}
