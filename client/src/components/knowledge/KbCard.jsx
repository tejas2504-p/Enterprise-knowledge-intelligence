import React from 'react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Database, Settings, MoreVertical } from 'lucide-react';

export default function KbCard({ kb }) {
  const getVisibilityBadge = (visibility) => {
    switch (visibility) {
      case 'organization':
        return <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">Organization</span>;
      case 'department':
        return <span className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded-full">Department</span>;
      default:
        return <span className="bg-slate-100 text-slate-800 text-xs px-2 py-1 rounded-full">Private</span>;
    }
  };

  const getStatusBadge = (status) => {
    return status === 'active' 
      ? <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">Active</span>
      : <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded-full">Archived</span>;
  };

  return (
    <Card className="h-full hover:shadow-md transition-shadow flex flex-col group hover:border-primary-200">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-50 text-primary-600 rounded-lg group-hover:bg-primary-100 transition-colors">
              <Database size={20} />
            </div>
            <div>
              <Link to={`/knowledge-bases/${kb._id}`} className="hover:underline">
                <CardTitle className="text-lg truncate">{kb.name}</CardTitle>
              </Link>
            </div>
          </div>
          <div className="flex gap-2">
            <Link to={`/knowledge-bases/${kb._id}/settings`}>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-600">
                <Settings size={16} />
              </Button>
            </Link>
          </div>
        </div>
        <CardDescription className="line-clamp-2 mt-3 text-sm">
          {kb.description || 'No description provided.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-auto pt-0">
        <div className="flex flex-wrap gap-2 mb-4">
          {getVisibilityBadge(kb.visibility)}
          {getStatusBadge(kb.status)}
        </div>
        <div className="flex justify-between items-center text-xs text-slate-500 border-t border-slate-100 pt-3">
          <div className="flex flex-col gap-1">
            <span>{kb.documentCount || 0} Documents</span>
            <span>{kb.totalSize ? (kb.totalSize / 1024 / 1024).toFixed(2) : 0} MB</span>
          </div>
          <div className="text-right">
            <span>Updated {new Date(kb.updatedAt || kb.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
