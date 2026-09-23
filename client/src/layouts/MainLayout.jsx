import { Outlet, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, Settings, Database, Bell, Search } from 'lucide-react';

export default function MainLayout() {
  const location = useLocation();

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Knowledge Base', href: '/knowledge', icon: Database },
    { name: 'Team', href: '/team', icon: Users },
    { name: 'Settings', href: '/settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <div className="w-64 bg-slate-850 text-slate-300 flex flex-col flex-shrink-0 border-r border-slate-800">
        <div className="h-16 flex items-center px-6 border-b border-slate-800 bg-slate-900/50">
          <Database className="w-6 h-6 text-primary-500 mr-3" />
          <span className="font-semibold text-white tracking-wide">Enterprise KI</span>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = location.pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                to={item.href}
                className={`flex items-center px-3 py-2.5 text-sm font-medium rounded-md transition-colors ${
                  isActive 
                    ? 'bg-primary-600/10 text-primary-500' 
                    : 'hover:bg-slate-800 hover:text-white'
                }`}
              >
                <item.icon className={`mr-3 flex-shrink-0 h-5 w-5 ${isActive ? 'text-primary-500' : 'text-slate-400'}`} />
                {item.name}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm font-medium text-white">
              JD
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-white">John Doe</p>
              <p className="text-xs text-slate-400">Admin</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-surface border-b border-slate-200 flex items-center justify-between px-8 flex-shrink-0">
          <div className="flex-1 flex">
            <div className="w-full max-w-lg relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-slate-400" />
              </div>
              <input
                className="block w-full pl-10 pr-3 py-2 border-transparent rounded-md leading-5 bg-slate-100 text-slate-900 placeholder-slate-500 focus:outline-none focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent sm:text-sm transition-colors"
                placeholder="Search across your enterprise knowledge..."
                type="search"
              />
            </div>
          </div>
          <div className="ml-4 flex items-center space-x-4">
            <button className="text-slate-400 hover:text-slate-500 transition-colors">
              <span className="sr-only">View notifications</span>
              <Bell className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
