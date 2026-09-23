import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8 text-center">
      <h1 className="text-9xl font-bold text-slate-200">404</h1>
      <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">Page not found</h2>
      <p className="mt-2 text-base text-slate-500 max-w-sm mx-auto">
        Sorry, we couldn't find the page you're looking for. It might have been moved or doesn't exist.
      </p>
      <div className="mt-8 flex gap-4 justify-center">
        <Link to="/">
          <Button variant="primary">Go back home</Button>
        </Link>
        <Link to="/contact">
          <Button variant="outline">Contact support</Button>
        </Link>
      </div>
    </div>
  );
}
