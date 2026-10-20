import React from 'react';
import { FileText, HardDrive, Eye, Building } from 'lucide-react';
import { StatCard } from '../ui/StatCard';
import { formatBytes } from '../../utils/formatters';

export default function KbStats({ kb }) {
  if (!kb) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
      <StatCard
        title="Total Documents"
        value={kb.documentCount || 0}
        subtitle={`${kb.documentCount || 0} files indexed`}
        icon={FileText}
        iconColor="text-blue-600"
        iconBg="bg-blue-50"
      />

      <StatCard
        title="Total Size"
        value={formatBytes(kb.totalSize || 0)}
        subtitle="Across all documents"
        icon={HardDrive}
        iconColor="text-indigo-600"
        iconBg="bg-indigo-50"
      />

      <StatCard
        title="Visibility"
        value={kb.visibility ? kb.visibility.charAt(0).toUpperCase() + kb.visibility.slice(1) : 'Private'}
        subtitle={
          kb.visibility === 'organization'
            ? 'Accessible organization-wide'
            : kb.visibility === 'department'
            ? 'Department members only'
            : 'Restricted to owner & admins'
        }
        icon={Eye}
        iconColor="text-purple-600"
        iconBg="bg-purple-50"
      />

      <StatCard
        title="Department"
        value={kb.department || 'Not Assigned'}
        subtitle={kb.organization || 'Default Workspace'}
        icon={Building}
        iconColor="text-emerald-600"
        iconBg="bg-emerald-50"
      />
    </div>
  );
}
