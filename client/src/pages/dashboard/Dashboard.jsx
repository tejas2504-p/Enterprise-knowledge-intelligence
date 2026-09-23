import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { FileText, Users, Activity, ArrowUpRight } from 'lucide-react';

export default function Dashboard() {
  const stats = [
    { name: 'Total Documents', value: '2,845', icon: FileText, change: '+12.5%', changeType: 'positive' },
    { name: 'Active Users', value: '842', icon: Users, change: '+5.2%', changeType: 'positive' },
    { name: 'Query Volume', value: '14,203', icon: Activity, change: '+24.8%', changeType: 'positive' },
  ];

  const recentActivity = [
    { id: 1, action: 'Document uploaded', user: 'Sarah Jenkins', target: 'Q3 Financial Report.pdf', time: '2 hours ago' },
    { id: 2, action: 'Query executed', user: 'Michael Chen', target: 'Engineering Roadmap 2027', time: '4 hours ago' },
    { id: 3, action: 'System sync', user: 'System', target: 'SharePoint Integration', time: '5 hours ago' },
    { id: 4, action: 'User invited', user: 'Admin', target: 'david@enterprise.com', time: '1 day ago' },
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Dashboard overview</h1>
          <p className="text-slate-500 mt-1">Welcome back. Here's what's happening today.</p>
        </div>
        <Button variant="primary">Generate Report</Button>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((item) => (
          <Card key={item.name}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">{item.name}</CardTitle>
              <item.icon className="h-4 w-4 text-slate-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{item.value}</div>
              <p className={`text-xs mt-1 font-medium ${item.changeType === 'positive' ? 'text-emerald-600' : 'text-red-600'}`}>
                {item.change} from last month
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="col-span-1 lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest actions performed across the platform.</CardDescription>
            </div>
            <Button variant="outline" size="sm">View all</Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Action</th>
                    <th scope="col" className="px-4 py-3 font-medium">User</th>
                    <th scope="col" className="px-4 py-3 font-medium">Target</th>
                    <th scope="col" className="px-4 py-3 font-medium">Time</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {recentActivity.map((activity, index) => (
                    <tr key={activity.id} className={index !== recentActivity.length - 1 ? 'border-b border-slate-100' : ''}>
                      <td className="px-4 py-3 font-medium text-slate-900">{activity.action}</td>
                      <td className="px-4 py-3 text-slate-600">{activity.user}</td>
                      <td className="px-4 py-3 text-slate-600">{activity.target}</td>
                      <td className="px-4 py-3 text-slate-500">{activity.time}</td>
                      <td className="px-4 py-3 text-right">
                        <button className="text-slate-400 hover:text-primary-600 transition-colors">
                          <ArrowUpRight className="h-4 w-4 inline" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
