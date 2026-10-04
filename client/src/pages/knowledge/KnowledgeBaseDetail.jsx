import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getKnowledgeBase, deleteKnowledgeBase } from '../../services/kbService';
import { getDocuments, uploadDocument, deleteDocument } from '../../services/docService';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { FileText, Upload, Trash2, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';

export default function KnowledgeBaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [kb, setKb] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const kbData = await getKnowledgeBase(id);
      setKb(kbData.data);
      const docsData = await getDocuments(id);
      setDocuments(docsData.data);
    } catch (err) {
      setError('Failed to load knowledge base details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    try {
      await uploadDocument(id, file);
      await fetchData(); // Refresh documents
    } catch (err) {
      console.error('Upload failed', err);
      alert('Failed to upload document');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDeleteDoc = async (docId) => {
    if (!window.confirm('Are you sure you want to delete this document?')) return;
    
    try {
      await deleteDocument(docId);
      setDocuments(documents.filter(d => d._id !== docId));
    } catch (err) {
      console.error('Delete failed', err);
      alert('Failed to delete document');
    }
  };

  const handleDeleteKb = async () => {
    if (!window.confirm('Are you sure you want to delete this knowledge base and all its documents? This cannot be undone.')) return;

    try {
      await deleteKnowledgeBase(id);
      navigate('/knowledge');
    } catch (err) {
      console.error('Failed to delete KB', err);
      alert('Failed to delete knowledge base');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-[50vh]">
        <Loader2 className="animate-spin text-primary-600" size={40} />
      </div>
    );
  }

  if (error || !kb) {
    return (
      <div className="p-8 max-w-7xl mx-auto text-center">
        <AlertCircle className="mx-auto text-red-500 mb-4" size={48} />
        <h2 className="text-2xl font-bold mb-4">{error || 'Knowledge Base not found'}</h2>
        <Button onClick={() => navigate('/knowledge')}>Go Back</Button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <Button variant="ghost" onClick={() => navigate('/knowledge')} className="mb-6 gap-2 -ml-4">
        <ArrowLeft size={16} /> Back to Knowledge Bases
      </Button>

      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{kb.name}</h1>
          <p className="text-slate-500 mt-2 max-w-2xl">{kb.description || 'No description provided.'}</p>
        </div>
        <div className="flex gap-3">
          <Button variant="danger" onClick={handleDeleteKb} className="gap-2">
            <Trash2 size={16} /> Delete KB
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Documents ({documents.length})</h2>
            <div>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
                accept=".pdf,.txt,.doc,.docx,.csv"
              />
              <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="gap-2">
                {uploading ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
                Upload Document
              </Button>
            </div>
          </div>

          {documents.length === 0 ? (
            <Card className="text-center py-12 border-dashed border-2">
              <div className="flex justify-center mb-4">
                <FileText className="text-slate-300" size={48} />
              </div>
              <CardTitle className="text-lg text-slate-600 mb-2">No documents yet</CardTitle>
              <CardDescription>Upload files to start building this knowledge base.</CardDescription>
            </Card>
          ) : (
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 font-medium text-slate-900">Name</th>
                    <th className="px-6 py-4 font-medium text-slate-900">Size</th>
                    <th className="px-6 py-4 font-medium text-slate-900">Status</th>
                    <th className="px-6 py-4 font-medium text-slate-900">Date Added</th>
                    <th className="px-6 py-4 font-medium text-slate-900 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {documents.map((doc) => (
                    <tr key={doc._id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <FileText size={16} className="text-primary-500" />
                          <span className="font-medium text-slate-900 truncate max-w-[200px]">
                            {doc.title}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-500">
                        {(doc.size / 1024 / 1024).toFixed(2)} MB
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          doc.status === 'completed' ? 'bg-green-100 text-green-800' :
                          doc.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                          doc.status === 'failed' ? 'bg-red-100 text-red-800' :
                          'bg-blue-100 text-blue-800'
                        }`}>
                          {doc.status.charAt(0).toUpperCase() + doc.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-500">
                        {new Date(doc.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleDeleteDoc(doc._id)}
                          className="text-slate-400 hover:text-red-500"
                        >
                          <Trash2 size={16} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Processing Pipeline</CardTitle>
              <CardDescription>RAG Pipeline Status</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 before:to-transparent">
                {[
                  { title: 'Text Extraction', status: 'pending' },
                  { title: 'Cleaning', status: 'pending' },
                  { title: 'Chunking', status: 'pending' },
                  { title: 'Embedding', status: 'pending' },
                  { title: 'Vector Database', status: 'pending' }
                ].map((step, index) => (
                  <div key={index} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-slate-100 text-slate-500 group-[.is-active]:bg-primary-50 group-[.is-active]:text-primary-600 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                      <span className="text-sm font-medium">{index + 1}</span>
                    </div>
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded bg-white shadow border border-slate-200">
                      <div className="flex items-center justify-between space-x-2 mb-1">
                        <div className="font-bold text-slate-900 text-sm">{step.title}</div>
                        <span className="text-xs font-medium text-slate-500">Pending</span>
                      </div>
                      <div className="text-slate-500 text-xs">Future implementation</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
