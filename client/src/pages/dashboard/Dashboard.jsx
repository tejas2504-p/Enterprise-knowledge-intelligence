import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { FileText, Database, Activity, Bot, ArrowUpRight, Clock, MoreVertical, File } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function Dashboard() {
  const { user } = useAuth();

  const stats = [
    { name: 'Total Documents', value: '12,845', icon: FileText, change: '+12.5%', changeType: 'positive' },
    { name: 'Knowledge Bases', value: '34', icon: Database, change: '+2', changeType: 'positive' },
    { name: 'Recent Queries', value: '1,204', icon: Activity, change: '+18.2%', changeType: 'positive' },
    { name: 'AI Questions', value: '842', icon: Bot, change: '+5.4%', changeType: 'positive' },
  ];

  const recentDocuments = [
    { id: 1, name: 'Q3 Financial Report.pdf', kb: 'Finance Dept', size: '2.4 MB', date: '2 hours ago' },
    { id: 2, name: 'Engineering Roadmap 2027.docx', kb: 'Engineering', size: '1.1 MB', date: '4 hours ago' },
    { id: 3, name: 'Employee Onboarding Guide.pdf', kb: 'HR Policies', size: '5.6 MB', date: 'Yesterday' },
    { id: 4, name: 'Q4 Marketing Strategy.pptx', kb: 'Marketing', size: '12.8 MB', date: 'Yesterday' },
  ];

  const recentActivity = [
    { id: 1, action: 'Document uploaded', user: 'Sarah Jenkins', target: 'Q3 Financial Report.pdf', time: '2 hours ago' },
    { id: 2, action: 'Query executed', user: 'Michael Chen', target: 'Engineering Roadmap 2027', time: '4 hours ago' },
    { id: 3, action: 'System sync', user: 'System', target: 'SharePoint Integration', time: '5 hours ago' },
    { id: 4, action: 'Knowledge Base created', user: 'Admin', target: 'Customer Success', time: '1 day ago' },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      {/* Welcome Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Welcome back, {user?.name ? user.name.split(' ')[0] : 'User'}
          </h1>
          <p className="text-slate-500 mt-1">Here is the latest intelligence from your enterprise knowledge bases.</p>
        </div>
        <div className="flex space-x-3">
          <Button variant="outline">View Analytics</Button>
          <Button variant="primary">New Query</Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => (
          <Card key={item.name} className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">{item.name}</CardTitle>
              <div className="p-2 bg-primary-50 rounded-lg">
                <item.icon className="h-4 w-4 text-primary-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{item.value}</div>
              <div className="flex items-center mt-1">
                <span className={`text-xs font-medium ${item.changeType === 'positive' ? 'text-emerald-600' : 'text-red-600'}`}>
                  {item.change}
                </span>
                <span className="text-xs text-slate-500 ml-1.5">from last month</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Recent Documents */}
        <Card className="border-slate-200/60 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <CardTitle className="text-lg">Recent Documents</CardTitle>
              <CardDescription>Latest files indexed in your knowledge bases.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="text-primary-600">View all</Button>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-4">
              {recentDocuments.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between group">
                  <div className="flex items-center space-x-3 truncate">
                    <div className="p-2 bg-slate-100 rounded-lg group-hover:bg-primary-50 transition-colors">
                      <File className="w-5 h-5 text-slate-500 group-hover:text-primary-600" />
                    </div>
                    <div className="truncate">
                      <p className="text-sm font-medium text-slate-900 truncate">{doc.name}</p>
                      <div className="flex items-center text-xs text-slate-500 mt-0.5">
                        <Database className="w-3 h-3 mr-1" />
                        <span>{doc.kb}</span>
                        <span className="mx-2">•</span>
                        <span>{doc.size}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 flex-shrink-0">
                    <span className="text-xs text-slate-400">{doc.date}</span>
                    <button className="p-1 text-slate-400 hover:text-slate-900 rounded">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="border-slate-200/60 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <CardTitle className="text-lg">Recent Activity</CardTitle>
              <CardDescription>Latest actions performed across the platform.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="text-primary-600">View all</Button>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-5">
              {recentActivity.map((activity, index) => (
                <div key={activity.id} className="relative pl-6 pb-5 last:pb-0">
                  {index !== recentActivity.length - 1 && (
                    <div className="absolute top-5 left-[11px] bottom-0 w-px bg-slate-200" />
                  )}
                  <div className="absolute top-1.5 left-0 w-[22px] h-[22px] bg-slate-100 rounded-full border-2 border-white flex items-center justify-center">
                    <Clock className="w-3 h-3 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-900">
                      <span className="font-medium">{activity.user}</span> {activity.action.toLowerCase()}{' '}
                      <span className="font-medium text-primary-600 cursor-pointer hover:underline">
                        {activity.target}
                      </span>
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">{activity.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
