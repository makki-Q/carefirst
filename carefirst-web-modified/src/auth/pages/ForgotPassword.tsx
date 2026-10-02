import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Heart, Mail, CheckCircle } from 'lucide-react';
import { useLocation } from 'wouter';

/**
 * CareFirst Forgot Password Page
 * 
 * Design Philosophy: Minimalist Trust (consistent with Login page)
 * - Asymmetric split-screen layout
 * - Premium micro-interactions and smooth animations
 * - DM Serif Display + DM Sans typography hierarchy
 * - Deep charcoal, healthcare red, and warm cream palette
 * 
 * User Flow:
 * 1. Enter email address
 * 2. Receive confirmation message
 * 3. Check email for reset link
 */

export default function ForgotPassword() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setTimeout(() => setVisible(true), 80);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    // Simulate API call
    setTimeout(() => {
      if (!email) {
        setError('Please enter your email address');
      } else if (!email.includes('@')) {
        setError('Please enter a valid email address');
      } else {
        // Success - in real app, this would send reset email
        setSubmitted(true);
        console.log('Password reset requested for:', email);
      }
      setIsLoading(false);
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-background flex overflow-hidden">
      {/* Left Column - Form */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center px-6 sm:px-8 lg:px-12 py-12 lg:py-0">
        <div className={`max-w-sm mx-auto w-full ${visible ? 'blur-in blur-in-delay-1' : ''}`}>
          {/* Back Button */}
          <button
            onClick={() => window.location.href = '/login'}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to login
          </button>

          {!submitted ? (
            <>
              {/* Logo & Branding */}
              <div className="mb-12">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="w-7 h-7 rounded-lg bg-foreground flex items-center justify-center">
                    <Heart className="w-4 h-4 text-background fill-background" />
                  </div>
                  <span className="text-lg font-serif font-normal tracking-tight text-foreground">
                    carefirst
                  </span>
                </div>
                <p className="text-sm font-normal text-muted-foreground mt-1">
                  Healthcare that fits your budget
                </p>
              </div>

              {/* Heading */}
              <div className={`mb-8 ${visible ? 'blur-in blur-in-delay-2' : ''}`}>
                <h1 className="text-3xl sm:text-4xl font-serif font-normal tracking-tight text-foreground mb-2">
                  Reset your password
                </h1>
                <p className="text-base font-light text-muted-foreground">
                  Enter your email address and we'll send you a OTP to reset your password
                </p>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className={`space-y-6 ${visible ? 'blur-in blur-in-delay-3' : ''}`}>
                {/* Error Message */}
                {error && (
                  <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 float-up">
                    <p className="text-sm font-medium text-destructive">{error}</p>
                  </div>
                )}

                {/* Email Field */}
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium text-foreground">
                    Email address
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isLoading}
                    className="h-11 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-accent/20 focus:ring-offset-2 focus:ring-offset-background transition-all duration-200"
                  />
                  <p className="text-xs text-muted-foreground">
                    We'll send a password reset OTP to this email address
                  </p>
                </div>

                {/* Submit Button */}
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-11 rounded-lg bg-foreground text-background font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                      Sending OTP...
                    </span>
                  ) : (
                    'Send reset OTP'
                  )}
                </Button>
              </form>

              {/* Help Text */}
              <div className={`mt-8 p-4 rounded-lg bg-muted border border-border ${visible ? 'blur-in blur-in-delay-3' : ''}`}>
                <p className="text-xs font-medium text-foreground mb-2">Didn't receive the email?</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>• Check your spam or junk folder</li>
                  <li>• Make sure you entered the correct email</li>
                  <li>• Try again in a few minutes</li>
                </ul>
              </div>
            </>
          ) : (
            <>
              {/* Success State */}
              <div className={`text-center ${visible ? 'blur-in blur-in-delay-2' : ''}`}>
                <div className="mb-6 flex justify-center">
                  <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center">
                    <CheckCircle className="w-8 h-8 text-accent" />
                  </div>
                </div>

                <h2 className="text-3xl sm:text-4xl font-serif font-normal tracking-tight text-foreground mb-3">
                  Check your email
                </h2>

                <p className="text-base font-light text-muted-foreground mb-2">
                  We've sent a password reset OTP to
                </p>
                <p className="text-base font-medium text-foreground mb-8">
                  {email}
                </p>

                <div className="space-y-3 mb-8">
                  <p className="text-sm text-muted-foreground">
                    The OTP will expire in 24 hours. Enter the OTP in the next screen to create a new password.
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="space-y-3">
                  <Button
                    onClick={() => window.location.href = '/login'}
                    className="w-full h-11 rounded-lg bg-foreground text-background font-medium hover:opacity-90 transition-opacity"
                  >
                    Back to login
                  </Button>
                  <Button
                    onClick={() => {
                      setSubmitted(false);
                      setEmail('');
                    }}
                    variant="outline"
                    className="w-full h-11 rounded-lg border border-border bg-card hover:bg-muted text-foreground font-medium transition-colors"
                  >
                    Try another email
                  </Button>
                </div>
              </div>

              {/* Help Section */}
              <div className={`mt-8 p-4 rounded-lg bg-muted border border-border text-center ${visible ? 'blur-in blur-in-delay-3' : ''}`}>
                <p className="text-xs font-medium text-foreground mb-2">Need help?</p>
                <p className="text-xs text-muted-foreground mb-3">
                  Contact our support team if you don't receive the reset link
                </p>
                <a href="#" className="text-xs font-medium text-accent hover:opacity-80 transition-opacity">
                  Contact support
                </a>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right Column - Visual Narrative (Desktop Only) */}
      <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-muted via-background to-muted flex-col items-center justify-center px-12 relative overflow-hidden">
        {/* Decorative Background Elements */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 right-10 w-64 h-64 bg-accent rounded-full blur-3xl" />
          <div className="absolute bottom-10 left-10 w-96 h-96 bg-foreground rounded-full blur-3xl" />
        </div>

        {/* Content */}
        <div className="relative z-10 max-w-md text-center">
          <div className={`${visible ? 'blur-in blur-in-delay-2' : ''}`}>
            <div className="mb-6 flex justify-center">
              <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center">
                <Mail className="w-8 h-8 text-accent" />
              </div>
            </div>
            <h2 className="text-2xl font-serif font-normal text-foreground mb-4">
              Secure password reset
            </h2>
            <p className="text-base font-light text-muted-foreground leading-relaxed">
              We'll send a secure OTP to your email address. Enter the OTP to create a new password for your CareFirst account.
            </p>
          </div>

          {/* Security Info */}
          <div className={`mt-8 space-y-4 ${visible ? 'blur-in blur-in-delay-3' : ''}`}>
            {[
              { title: 'Secure OTP', desc: 'One-time use reset code' },
              { title: 'Quick Process', desc: 'Takes less than 2 minutes' },
              { title: 'Your Privacy', desc: 'We never share your data' },
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

        {/* Bottom Accent */}
        <div className={`absolute bottom-8 left-8 right-8 ${visible ? 'blur-in blur-in-delay-3' : ''}`}>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Your account security matters to us
          </p>
        </div>
      </div>
    </div>
  );
}
