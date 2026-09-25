import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';

export default function Register() {
  const navigate = useNavigate();
  const { register } = useAuth();
  
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);
    setIsSubmitting(true);
    
    try {
      await register({ name, email, password });
      navigate('/dashboard');
    } catch (err) {
      setLocalError(err.response?.data?.message || 'Failed to register. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h3 className="text-xl font-semibold text-slate-900">Create an account</h3>
        <p className="mt-1 text-sm text-slate-500">
          Get started with your enterprise workspace.
        </p>
      </div>

      {localError && (
        <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-md border border-red-100">
          {localError}
        </div>
      )}

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">
            Full name
          </label>
          <Input
            id="name"
            name="name"
            type="text"
            required
            placeholder="Jane Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

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
          <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
            Password
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <Button type="submit" className="w-full mt-2" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account...' : 'Create account'}
        </Button>
      </form>

      <div className="mt-6 text-center text-sm">
        <span className="text-slate-500">Already have an account? </span>
        <Link to="/login" className="font-medium text-primary-600 hover:text-primary-500">
          Sign in
        </Link>
      </div>
    </div>
  );
}
