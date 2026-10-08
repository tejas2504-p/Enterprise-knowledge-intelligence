import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getKnowledgeBase } from '../../services/kbService';
import { getDocuments, uploadDocument, deleteDocument } from '../../services/docService';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { 
  FileText, Upload, Trash2, ArrowLeft, Loader2, AlertCircle, 
  Settings, Search, Database, File, Filter, CheckCircle2, 
  XCircle, Clock, X, Info
} from 'lucide-react';

export default function KnowledgeBaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [kb, setKb] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  
  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);
  
  // Selection state
  const [selectedDocs, setSelectedDocs] = useState(new Set());
  
  // Details Modal state
  const [selectedDocForDetails, setSelectedDocForDetails] = useState(null);

  const fetchData = useCallback(async () => {
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
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleFiles = async (files) => {
    if (!files || files.length === 0) return;
    
    setUploading(true);
    let successCount = 0;
    
    for (let i = 0; i < files.length; i++) {
      try {
        await uploadDocument(id, files[i]);
        successCount++;
      } catch (err) {
        console.error('Upload failed for file', files[i].name, err);
      }
    }
    
    setUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    
    if (successCount < files.length) {
      alert(`Uploaded ${successCount} out of ${files.length} files successfully.`);
    }
    
    fetchData(); // Refresh documents
  };

  const handleFileUpload = (e) => {
    handleFiles(e.target.files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (kb?.status !== 'archived') {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (kb?.status !== 'archived' && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleDeleteDoc = async (docId) => {
    if (!window.confirm('Are you sure you want to delete this document?')) return;
    
    try {
      await deleteDocument(docId);
      setDocuments(documents.filter(d => d._id !== docId));
      fetchData(); // Refresh kb stats
      if (selectedDocs.has(docId)) {
        const newSelected = new Set(selectedDocs);
        newSelected.delete(docId);
        setSelectedDocs(newSelected);
      }
    } catch (err) {
      console.error('Delete failed', err);
      alert('Failed to delete document');
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedDocs.size === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedDocs.size} selected documents?`)) return;
    
    for (const docId of selectedDocs) {
      try {
        await deleteDocument(docId);
      } catch (err) {
        console.error('Delete failed for doc', docId, err);
      }
    }
    setSelectedDocs(new Set());
    fetchData();
  };

  const toggleSelectAll = () => {
    if (selectedDocs.size === filteredDocs.length && filteredDocs.length > 0) {
      setSelectedDocs(new Set());
    } else {
      setSelectedDocs(new Set(filteredDocs.map(d => d._id)));
    }
  };

  const toggleSelectDoc = (docId) => {
    const newSelected = new Set(selectedDocs);
    if (newSelected.has(docId)) {
      newSelected.delete(docId);
    } else {
      newSelected.add(docId);
    }
    setSelectedDocs(newSelected);
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
        <Button onClick={() => navigate('/knowledge-bases')}>Go Back</Button>
      </div>
    );
  }

  const filteredDocs = documents.filter(doc => {
    const matchesSearch = doc.title.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || doc.processingStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusIndicator = (status) => {
    switch (status) {
      case 'processed':
        return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800"><CheckCircle2 size={14} /> Processed</span>;
      case 'processing':
        return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800"><Loader2 size={14} className="animate-spin" /> Processing</span>;
      case 'failed':
        return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800"><XCircle size={14} /> Failed</span>;
      case 'uploaded':
      default:
        return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-800"><Clock size={14} /> Uploaded</span>;
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <Button variant="ghost" onClick={() => navigate('/knowledge-bases')} className="mb-6 gap-2 -ml-4">
        <ArrowLeft size={16} /> Back to Knowledge Bases
      </Button>

      <div className="flex flex-col md:flex-row justify-between items-start mb-8 gap-4">
        <div className="flex gap-4 items-start">
          <div className="p-3 bg-primary-50 text-primary-600 rounded-lg hidden md:block">
            <Database size={32} />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-slate-900">{kb.name}</h1>
              <span className={`text-xs px-2 py-1 rounded-full ${
                kb.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
              }`}>
                {kb.status === 'active' ? 'Active' : 'Archived'}
              </span>
            </div>
            <p className="text-slate-500 mt-2 max-w-2xl">{kb.description || 'No description provided.'}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Link to={`/knowledge-bases/${id}/settings`}>
            <Button variant="outline" className="gap-2">
              <Settings size={16} /> Settings
            </Button>
          </Link>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
            accept=".pdf,.txt,.doc,.docx,.csv"
            multiple
          />
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploading || kb.status === 'archived'} className="gap-2">
            {uploading ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
            Upload Document
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card className="bg-white">
          <CardContent className="p-6">
            <div className="text-sm font-medium text-slate-500 mb-1">Total Documents</div>
            <div className="text-2xl font-bold text-slate-900">{kb.documentCount || 0}</div>
          </CardContent>
        </Card>
        <Card className="bg-white">
          <CardContent className="p-6">
            <div className="text-sm font-medium text-slate-500 mb-1">Total Size</div>
            <div className="text-2xl font-bold text-slate-900">{kb.totalSize ? (kb.totalSize / 1024 / 1024).toFixed(2) : 0} MB</div>
          </CardContent>
        </Card>
        <Card className="bg-white">
          <CardContent className="p-6">
            <div className="text-sm font-medium text-slate-500 mb-1">Visibility</div>
            <div className="text-2xl font-bold text-slate-900 capitalize">{kb.visibility || 'Private'}</div>
          </CardContent>
        </Card>
        <Card className="bg-white">
          <CardContent className="p-6">
            <div className="text-sm font-medium text-slate-500 mb-1">Department</div>
            <div className="text-2xl font-bold text-slate-900 truncate">{kb.department || '-'}</div>
          </CardContent>
        </Card>
      </div>
      
      {/* Drag & Drop Upload Area */}
      <div 
        className={`mb-8 p-12 border-2 border-dashed rounded-xl text-center transition-all duration-200 ${
          isDragging 
            ? 'border-primary-500 bg-primary-50' 
            : kb.status === 'archived'
              ? 'border-slate-200 bg-slate-50 opacity-60'
              : 'border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-slate-400'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex flex-col items-center justify-center pointer-events-none">
          <Upload className={`mb-4 ${isDragging ? 'text-primary-500' : 'text-slate-400'}`} size={48} />
          <h3 className="text-lg font-semibold text-slate-700 mb-2">
            {isDragging ? 'Drop files here' : 'Drag & drop files here'}
          </h3>
          <p className="text-slate-500 mb-6">Support for PDF, TXT, DOCX, CSV. Max 50MB per file.</p>
          <Button 
            onClick={() => fileInputRef.current?.click()} 
            disabled={uploading || kb.status === 'archived'} 
            variant="outline"
            className="pointer-events-auto"
          >
            Or browse files
          </Button>
          {uploading && (
            <div className="mt-4 flex items-center text-primary-600">
              <Loader2 className="animate-spin mr-2" size={16} /> Uploading...
            </div>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            Documents <span className="bg-slate-100 text-slate-600 text-xs py-0.5 px-2 rounded-full">{documents.length}</span>
          </h2>
          
          <div className="flex flex-wrap items-center gap-3">
            {selectedDocs.size > 0 && (
              <Button variant="destructive" size="sm" onClick={handleDeleteSelected} className="gap-2">
                <Trash2 size={16} /> Delete Selected ({selectedDocs.size})
              </Button>
            )}
            
            <div className="flex items-center gap-2 border border-slate-200 rounded-md bg-white px-3 py-1.5">
              <Filter size={16} className="text-slate-400" />
              <select 
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-sm bg-transparent border-none focus:outline-none text-slate-700 w-32"
              >
                <option value="all">All Statuses</option>
                <option value="uploaded">Uploaded</option>
                <option value="processing">Processing</option>
                <option value="processed">Processed</option>
                <option value="failed">Failed</option>
              </select>
            </div>

            <div className="relative w-full sm:w-64">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search size={16} className="text-slate-400" />
              </div>
              <input
                type="text"
                placeholder="Search documents..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-200 rounded-md focus:ring-2 focus:ring-primary-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {documents.length === 0 ? (
          <Card className="text-center py-16 border-dashed border-2 shadow-sm">
            <div className="flex justify-center mb-4">
              <FileText className="text-slate-300" size={56} />
            </div>
            <CardTitle className="text-xl text-slate-700 mb-2">No documents yet</CardTitle>
            <CardDescription className="max-w-md mx-auto">
              Upload files to start building this knowledge base. Drag and drop files in the area above.
            </CardDescription>
          </Card>
        ) : filteredDocs.length === 0 ? (
          <Card className="text-center py-12 border-dashed border-2 shadow-sm">
            <CardTitle className="text-lg text-slate-600 mb-2">No results found</CardTitle>
            <CardDescription>No documents match your search or filter criteria.</CardDescription>
          </Card>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-500 uppercase tracking-wider text-xs font-semibold">
                  <tr>
                    <th className="px-6 py-4 w-12">
                      <input 
                        type="checkbox" 
                        className="rounded border-slate-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                        checked={selectedDocs.size === filteredDocs.length && filteredDocs.length > 0}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th className="px-6 py-4">Document Name</th>
                    <th className="px-6 py-4">Type</th>
                    <th className="px-6 py-4">Size</th>
                    <th className="px-6 py-4">Uploaded By</th>
                    <th className="px-6 py-4">Date</th>
                    <th className="px-6 py-4">Words</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredDocs.map((doc) => (
                    <tr 
                      key={doc._id} 
                      className={`hover:bg-slate-50 transition-colors group cursor-pointer ${selectedDocs.has(doc._id) ? 'bg-primary-50/50' : ''}`}
                      onClick={() => setSelectedDocForDetails(doc)}
                    >
                      <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                        <input 
                          type="checkbox" 
                          className="rounded border-slate-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                          checked={selectedDocs.has(doc._id)}
                          onChange={() => toggleSelectDoc(doc._id)}
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <File size={16} className="text-primary-500 shrink-0" />
                          <span className="font-medium text-slate-900 truncate max-w-[200px]" title={doc.title || doc.originalFileName}>
                            {doc.title || doc.originalFileName}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-500 uppercase text-xs font-medium">
                        {doc.fileType || 'UNK'}
                      </td>
                      <td className="px-6 py-4 text-slate-500">
                        {doc.fileSize ? (doc.fileSize / 1024 / 1024).toFixed(2) + ' MB' : '-'}
                      </td>
                      <td className="px-6 py-4 text-slate-500">
                        {doc.uploadedBy?.name || 'Unknown'}
                      </td>
                      <td className="px-6 py-4 text-slate-500">
                        {new Date(doc.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-slate-500">
                        {doc.wordCount ? doc.wordCount.toLocaleString() : '-'}
                      </td>
                      <td className="px-6 py-4">
                        {getStatusIndicator(doc.processingStatus)}
                      </td>
                      <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDocForDetails(doc);
                            }}
                            className="text-slate-400 hover:text-primary-600 h-8 w-8"
                          >
                            <Info size={16} />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteDoc(doc._id);
                            }}
                            className="text-slate-400 hover:text-red-500 h-8 w-8"
                            disabled={kb.status === 'archived'}
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Document Details Modal */}
      {selectedDocForDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <FileText size={18} className="text-primary-500" />
                Document Details
              </h3>
              <button 
                onClick={() => setSelectedDocForDetails(null)}
                className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-md hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto">
              <div className="flex flex-col gap-6">
                <div>
                  <h4 className="text-sm font-medium text-slate-500 mb-1">Filename</h4>
                  <p className="text-base font-medium text-slate-900 break-all">{selectedDocForDetails.originalFileName || selectedDocForDetails.title}</p>
                </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
                  <div>
                    <h4 className="text-sm font-medium text-slate-500 mb-1">File Type</h4>
                    <p className="text-sm text-slate-900 uppercase">{selectedDocForDetails.fileType || 'Unknown'}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-slate-500 mb-1">Size</h4>
                    <p className="text-sm text-slate-900">{selectedDocForDetails.fileSize ? (selectedDocForDetails.fileSize / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown'}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-slate-500 mb-1">Upload Date</h4>
                    <p className="text-sm text-slate-900">{new Date(selectedDocForDetails.createdAt).toLocaleString()}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-slate-500 mb-1">Uploaded By</h4>
                    <p className="text-sm text-slate-900">{selectedDocForDetails.uploadedBy?.name || 'Unknown User'}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-slate-500 mb-1">Status</h4>
                    <div>{getStatusIndicator(selectedDocForDetails.processingStatus)}</div>
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-6 grid grid-cols-3 gap-6">
                  <div className="bg-slate-50 p-4 rounded-lg">
                    <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Pages</h4>
                    <p className="text-xl font-semibold text-slate-900">{selectedDocForDetails.pageCount || '-'}</p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-lg">
                    <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Words</h4>
                    <p className="text-xl font-semibold text-slate-900">{selectedDocForDetails.wordCount?.toLocaleString() || '-'}</p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-lg">
                    <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Characters</h4>
                    <p className="text-xl font-semibold text-slate-900">{selectedDocForDetails.characterCount?.toLocaleString() || '-'}</p>
                  </div>
                </div>

                {selectedDocForDetails.processingStatus === 'failed' && selectedDocForDetails.processingError && (
                  <div className="bg-red-50 border border-red-100 rounded-lg p-4 mt-2 text-sm text-red-800">
                    <strong className="block mb-1 font-semibold flex items-center gap-1"><AlertCircle size={14} /> Processing Error:</strong>
                    {selectedDocForDetails.processingError}
                  </div>
                )}
              </div>
            </div>
            
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
              <Button variant="outline" onClick={() => setSelectedDocForDetails(null)}>
                Close
              </Button>
              <Button 
                variant="destructive" 
                onClick={() => {
                  handleDeleteDoc(selectedDocForDetails._id);
                  setSelectedDocForDetails(null);
                }}
                disabled={kb.status === 'archived'}
                className="gap-2"
              >
                <Trash2 size={16} /> Delete Document
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
