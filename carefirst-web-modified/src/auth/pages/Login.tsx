import { useState, useEffect } from 'react';
import { Button } from '../components/ui/button';
import { Input }  from '../components/ui/input';
import { Label }  from '../components/ui/label';
import { Eye, EyeOff, Heart, ArrowLeft } from 'lucide-react';
import { api, saveSession, getDashboardPath } from '../../lib/api';

export default function Login() {
  const [identifier, setIdentifier] = useState('');   // email or "admin"
  const [password,   setPassword]   = useState('');
  const [showPw,     setShowPw]     = useState(false);
  const [isLoading,  setIsLoading]  = useState(false);
  const [error,      setError]      = useState('');
  const [visible,    setVisible]    = useState(false);

  useEffect(() => { setTimeout(() => setVisible(true), 80); }, []);

  const isAdminLogin = !identifier.includes('@') && identifier.trim() !== '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!identifier.trim() || !password) {
      setError('Please fill in all fields');
      return;
    }

    setIsLoading(true);
    try {
      let data;

      if (isAdminLogin) {
        // username/password login for admin
        data = await api.post('/admin/login', { username: identifier.trim(), password });
      } else {
        // email/password login for lawyer / lab / doctor / patient
        data = await api.post('/auth/login', { email: identifier.trim(), password });
      }

      saveSession(data.token, data.user);
      window.location.href = getDashboardPath(data.user.role);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex overflow-hidden">
      {/* Left Column — Login Form */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center px-6 sm:px-8 lg:px-12 py-12 lg:py-0">
        <div className={`max-w-sm mx-auto w-full ${visible ? 'blur-in blur-in-delay-1' : ''}`}>

          {/* Back */}
          <button
            onClick={() => window.location.href = '/'}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to landing page
          </button>

          {/* Logo */}
          <div className="mb-12">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-7 h-7 rounded-lg bg-foreground flex items-center justify-center">
                <Heart className="w-4 h-4 text-background fill-background" />
              </div>
              <span className="text-lg font-serif font-normal tracking-tight text-foreground">carefirst</span>
            </div>
            <p className="text-sm font-normal text-muted-foreground mt-1">Healthcare that fits your budget</p>
          </div>

          {/* Heading */}
          <div className={`mb-8 ${visible ? 'blur-in blur-in-delay-2' : ''}`}>
            <h1 className="text-3xl sm:text-4xl font-serif font-normal tracking-tight text-foreground mb-2">
              Welcome back
            </h1>
            <p className="text-base font-light text-muted-foreground">
              {isAdminLogin
                ? 'Signing in as Administrator'
                : 'Sign in to your CareFirst account'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className={`space-y-6 ${visible ? 'blur-in blur-in-delay-3' : ''}`}>
            {error && (
              <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 float-up">
                <p className="text-sm font-medium text-destructive">{error}</p>
              </div>
            )}

            {/* Email / Username */}
            <div className="space-y-2">
              <Label htmlFor="identifier" className="text-sm font-medium text-foreground">
                {isAdminLogin ? 'Username' : 'Email address'}
              </Label>
              <Input
                id="identifier"
                type={isAdminLogin ? 'text' : 'email'}
                placeholder={isAdminLogin ? 'admin' : 'name@example.com'}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                disabled={isLoading}
                autoComplete="username"
                className="h-11 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-accent/20 focus:ring-offset-2 focus:ring-offset-background transition-all duration-200"
              />
              {!identifier && (
                <p className="text-xs text-muted-foreground">
                  Enter your email <span className="font-mono font-semibold"></span> 
                </p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium text-foreground">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  autoComplete="current-password"
                  className="h-11 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-accent/20 focus:ring-offset-2 focus:ring-offset-background transition-all duration-200 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  disabled={isLoading}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 rounded-lg bg-foreground text-background font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : 'Sign in'}
            </Button>
          </form>

          {/* Sign up link */}
          <div className={`mt-8 text-center ${visible ? 'blur-in blur-in-delay-3' : ''}`}>
            <p className="text-sm text-muted-foreground">
              Don't have an account?{' '}
              <a href="/signup" className="font-medium text-foreground hover:text-accent transition-colors">
                Register your practice
              </a>
            </p>
          </div>

          {/* Footer */}
          <div className={`mt-8 flex items-center justify-center gap-4 text-xs text-muted-foreground ${visible ? 'blur-in blur-in-delay-3' : ''}`}>
            <a href="#" className="hover:text-foreground transition-colors">Terms</a>
            <span className="w-px h-4 bg-border" />
            <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
            <span className="w-px h-4 bg-border" />
            <a href="#" className="hover:text-foreground transition-colors">Support</a>
          </div>
        </div>
      </div>

      {/* Right Column */}
      <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-muted via-background to-muted flex-col items-center justify-center px-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 right-10 w-64 h-64 bg-accent rounded-full blur-3xl" />
          <div className="absolute bottom-10 left-10 w-96 h-96 bg-foreground rounded-full blur-3xl" />
        </div>
        <div className="relative z-10 max-w-md text-center">
          <div className={visible ? 'blur-in blur-in-delay-2' : ''}>
            <div className="mb-6 flex justify-center">
              <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center">
                <Heart className="w-8 h-8 text-accent" />
              </div>
            </div>
            <h2 className="text-2xl font-serif font-normal text-foreground mb-4">
              Healthcare that fits your budget
            </h2>
            <p className="text-base font-light text-muted-foreground leading-relaxed mb-8">
              CareFirst bridges patients and diagnostic labs through transparent pricing, installment plans backed by legal agreements, and charity support for those who can't afford care.
            </p>
          </div>
          <div className={`space-y-4 ${visible ? 'blur-in blur-in-delay-3' : ''}`}>
            {[
              { title: 'Transparent Pricing', desc: 'Know costs upfront' },
              { title: 'Flexible Plans',      desc: 'Installments that work for you' },
              { title: 'Support Available',   desc: 'Charity assistance when needed' },
            ].map((item, idx) => (
              <div key={idx} className="flex items-start gap-3 text-left">
                <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-accent" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className={`absolute bottom-8 left-8 right-8 ${visible ? 'blur-in blur-in-delay-3' : ''}`}>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Trusted by leading diagnostic labs
          </p>
        </div>
      </div>
    </div>
  );
}
