import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);
    setIsSubmitting(true);
    
    try {
      await login(email, password);
      // PublicRoute will auto-redirect, but we can also manually navigate
      navigate('/dashboard');
    } catch (err) {
      setLocalError(err.response?.data?.message || 'Failed to login. Please check your credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h3 className="text-xl font-semibold text-slate-900">Sign in to your account</h3>
        <p className="mt-1 text-sm text-slate-500">
          Enter your details to access the platform.
        </p>
      </div>

      {localError && (
        <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-md border border-red-100">
          {localError}
        </div>
      )}

      <form className="space-y-5" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
            Email address
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@enterprise.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
              Password
            </label>
            <a href="#" className="text-sm font-medium text-primary-600 hover:text-primary-500">
              Forgot password?
            </a>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>

      <div className="mt-6 text-center text-sm">
        <span className="text-slate-500">Don't have an account? </span>
        <Link to="/register" className="font-medium text-primary-600 hover:text-primary-500">
          Sign up
        </Link>
      </div>
    </div>
  );
}
