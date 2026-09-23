import { Outlet } from 'react-router-dom';
import { Database } from 'lucide-react';

export default function AuthLayout() {
  return (
    <div className="min-h-screen bg-background flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="flex justify-center mb-6">
          <div className="bg-primary-600 p-3 rounded-lg shadow-soft">
            <Database className="w-8 h-8 text-white" />
          </div>
        </div>
        <h2 className="text-3xl font-bold tracking-tight text-slate-900">
          Enterprise Knowledge
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Intelligence Platform
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-surface py-8 px-4 shadow-soft-lg sm:rounded-xl sm:px-10 border border-slate-200/60">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
