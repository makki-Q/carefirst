import { useState, useEffect } from 'react';
import { Button } from '../components/ui/button';
import { Input }  from '../components/ui/input';
import { Label }  from '../components/ui/label';
import { Eye, EyeOff, Heart, CheckCircle, ArrowLeft } from 'lucide-react';
import { api, formatCnic } from '../../lib/api';

type Role = 'patient' | 'lawyer' | 'lab' | 'doctor' | '';

export default function SignUp() {
  const [role,    setRole]    = useState<Role>('');
  const [visible, setVisible] = useState(false);
  const [step,    setStep]    = useState<'role' | 'form' | 'done'>('role');
  const [isLoading, setIsLoading] = useState(false);
  const [error,     setError]     = useState('');
  const [showPw,    setShowPw]    = useState(false);
  const [showCpw,   setShowCpw]   = useState(false);

  const [form, setForm] = useState({
    name: '', email: '', phone: '', password: '', confirmPassword: '',
    // patient
    cnic: '', city: '', address: '',
    // lab
    labName: '', location: '', licenseNumber: '',
    // doctor
    specialization: '', experience: '',
    // lawyer
    barNumber: '',
  });

  useEffect(() => { setTimeout(() => setVisible(true), 80); }, []);

  const handle = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const ROLE_LABELS: Record<string, string> = {
    patient: 'Patient',
    lab:    'Diagnostic Lab',
    doctor: 'Doctor',
    lawyer: 'Lawyer',
  };

  // ── Step 1: Role selection ───────────────────────────────────────────────────
  const handleRoleSelect = (r: Role) => {
    setRole(r);
    setStep('form');
  };

  // ── Step 2: Form submit → POST /api/auth/register ───────────────────────────
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    // Base validation
    if (!form.name || !form.email || !form.password || !form.confirmPassword) {
      setError('Please fill in all required fields'); return;
    }
    const emailRe = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,6}$/;
    const emailDomain   = form.email.split('@')[1] || '';
    const domainBeforeTLD = emailDomain.substring(0, emailDomain.lastIndexOf('.'));
    if (!emailRe.test(form.email) || !/[a-zA-Z]/.test(domainBeforeTLD)) {
      setError('Enter a valid email address (e.g. user@domain.com)'); return;
    }
    if (form.phone) {
      const digits = form.phone.replace(/[\s\-().]/g, '');
      if (!/^\d{11}$/.test(digits)) { setError('Phone number must be exactly 11 digits (e.g. 03001234567)'); return; }
    }
    if (form.password.length < 8)  { setError('Password must be at least 8 characters'); return; }
    if (form.password !== form.confirmPassword) { setError('Passwords do not match'); return; }

    // Role-specific validation
    if (role === 'patient' && !formatCnic(form.cnic)) { setError('Enter a valid 13-digit CNIC (e.g. 35202-1234567-8)'); return; }
    if (role === 'lab'    && (!form.labName || !form.location))  { setError('Lab name and location are required'); return; }
    if (role === 'doctor' && !form.specialization)               { setError('Specialization is required'); return; }

    setIsLoading(true);
    try {
      const payload: Record<string, string> = {
        name: form.name, email: form.email, phone: form.phone,
        password: form.password, role,
      };
      if (role === 'patient') {
        payload.cnic    = formatCnic(form.cnic) as string;
        payload.city    = form.city;
        payload.address = form.address;
      }
      if (role === 'lab') {
        payload.labName = form.labName;
        payload.location = form.location;
        payload.licenseNumber = form.licenseNumber;
      }
      if (role === 'doctor') {
        payload.specialization = form.specialization;
        payload.experience = form.experience;
      }
      if (role === 'lawyer') {
        payload.barNumber = form.barNumber;
      }

      await api.post('/auth/register', payload);
      setStep('done');
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex overflow-hidden">
      {/* Left Column */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center px-6 sm:px-8 lg:px-12 py-12 lg:py-0">
        <div className={`max-w-sm mx-auto w-full ${visible ? 'blur-in blur-in-delay-1' : ''}`}>

          {/* ── STEP 1 — Role selection ────────────────────────────────────────── */}
          {step === 'role' && (
            <>
              <button
                onClick={() => window.location.href = '/login'}
                className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-8"
              >
                <ArrowLeft className="w-4 h-4" /> Back to login
              </button>

              <div className="mb-10">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="w-7 h-7 rounded-lg bg-foreground flex items-center justify-center">
                    <Heart className="w-4 h-4 text-background fill-background" />
                  </div>
                  <span className="text-lg font-serif font-normal tracking-tight text-foreground">carefirst</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">Healthcare that fits your budget</p>
              </div>

              <div className={visible ? 'blur-in blur-in-delay-2' : ''}>
                <h1 className="text-3xl font-serif font-normal tracking-tight text-foreground mb-2">
                  Join CareFirst
                </h1>
                <p className="text-base font-light text-muted-foreground mb-8">
                  Select your role to continue registration
                </p>
              </div>

              <div className={`space-y-3 ${visible ? 'blur-in blur-in-delay-3' : ''}`}>
                {([
                  { role: 'patient', label: 'Patient',         desc: 'Find doctors, compare lab prices and track your payments' },
                  { role: 'lab',    label: 'Diagnostic Lab',   desc: 'Register your lab and manage test catalog' },
                  { role: 'doctor', label: 'Doctor',           desc: 'Manage appointments and prescribe tests' },
                  { role: 'lawyer', label: 'Lawyer',           desc: 'Handle defaulter cases assigned by the platform' },
                ] as { role: Role; label: string; desc: string }[]).map(item => (
                  <button
                    key={item.role}
                    onClick={() => handleRoleSelect(item.role)}
                    className="w-full text-left p-4 rounded-xl border border-border bg-card hover:border-foreground hover:bg-muted transition-all duration-200 group"
                  >
                    <div className="font-semibold text-sm text-foreground group-hover:text-foreground mb-1">
                      {item.label}
                    </div>
                    <div className="text-xs text-muted-foreground">{item.desc}</div>
                  </button>
                ))}
              </div>

              <div className="mt-8 text-center">
                <p className="text-sm text-muted-foreground">
                  Already have an account?{' '}
                  <a href="/login" className="font-medium text-foreground hover:text-accent transition-colors">
                    Sign in
                  </a>
                </p>
              </div>
            </>
          )}

          {/* ── STEP 2 — Registration form ─────────────────────────────────────── */}
          {step === 'form' && (
            <>
              <button
                onClick={() => { setStep('role'); setError(''); }}
                className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-8"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>

              <div className="mb-8">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-7 h-7 rounded-lg bg-foreground flex items-center justify-center">
                    <Heart className="w-4 h-4 text-background fill-background" />
                  </div>
                  <span className="text-lg font-serif font-normal tracking-tight text-foreground">carefirst</span>
                </div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted border border-border text-xs font-medium text-muted-foreground mb-3">
                  Registering as: <span className="text-foreground font-semibold">{ROLE_LABELS[role]}</span>
                </div>
                <h1 className="text-3xl font-serif font-normal tracking-tight text-foreground mb-1">
                  Create your account
                </h1>
                <p className="text-sm font-light text-muted-foreground">
                  {role === 'patient'
                    ? 'You can log in right after signing up'
                    : 'Your account will be reviewed by admin before activation'}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                    <p className="text-sm font-medium text-destructive">{error}</p>
                  </div>
                )}

                {/* Common fields */}
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-sm font-medium text-foreground">
                    Full name <span className="text-destructive">*</span>
                  </Label>
                  <Input id="name" name="name" type="text" placeholder="Your full name"
                    value={form.name} onChange={handle} disabled={isLoading}
                    className="h-11 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground transition-all duration-200" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium text-foreground">
                    Email address <span className="text-destructive">*</span>
                  </Label>
                  <Input id="email" name="email" type="email" placeholder="name@example.com"
                    value={form.email} onChange={handle} disabled={isLoading}
                    className="h-11 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground transition-all duration-200" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-sm font-medium text-foreground">Phone</Label>
                  <Input id="phone" name="phone" type="tel" placeholder="0300-1234567"
                    value={form.phone} onChange={handle} disabled={isLoading}
                    className="h-11 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground transition-all duration-200" />
                </div>

                {/* ── Patient-specific ─────────────────────────────────────────── */}
                {role === 'patient' && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="cnic" className="text-sm font-medium text-foreground">
                        CNIC <span className="text-destructive">*</span>
                      </Label>
                      <Input id="cnic" name="cnic" type="text" inputMode="numeric" maxLength={15} placeholder="35202-1234567-8"
                        value={form.cnic} onChange={handle} disabled={isLoading}
                        className="h-11 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground transition-all duration-200" />
                      <p className="text-xs text-muted-foreground">Verified by our admin before community support and installment plans are enabled.</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="city" className="text-sm font-medium text-foreground">City</Label>
                      <Input id="city" name="city" type="text" placeholder="e.g. Lahore"
                        value={form.city} onChange={handle} disabled={isLoading}
                        className="h-11 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground transition-all duration-200" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="address" className="text-sm font-medium text-foreground">Address</Label>
                      <Input id="address" name="address" type="text" placeholder="House, street, area"
                        value={form.address} onChange={handle} disabled={isLoading}
                        className="h-11 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground transition-all duration-200" />
                    </div>
                  </>
                )}

                {/* ── Lab-specific ─────────────────────────────────────────────── */}
                {role === 'lab' && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="labName" className="text-sm font-medium text-foreground">
                        Lab name <span className="text-destructive">*</span>
                      </Label>
                      <Input id="labName" name="labName" type="text" placeholder="e.g. LifeCare Diagnostics"
                        value={form.labName} onChange={handle} disabled={isLoading}
                        className="h-11 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground transition-all duration-200" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="location" className="text-sm font-medium text-foreground">
                        Location <span className="text-destructive">*</span>
                      </Label>
                      <Input id="location" name="location" type="text" placeholder="e.g. Gulberg III, Lahore"
                        value={form.location} onChange={handle} disabled={isLoading}
                        className="h-11 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground transition-all duration-200" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="licenseNumber" className="text-sm font-medium text-foreground">License number</Label>
                      <Input id="licenseNumber" name="licenseNumber" type="text" placeholder="LAB-2024-001"
                        value={form.licenseNumber} onChange={handle} disabled={isLoading}
                        className="h-11 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground transition-all duration-200" />
                    </div>
                  </>
                )}

                {/* ── Doctor-specific ───────────────────────────────────────────── */}
                {role === 'doctor' && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="specialization" className="text-sm font-medium text-foreground">
                        Specialization <span className="text-destructive">*</span>
                      </Label>
                      <Input id="specialization" name="specialization" type="text" placeholder="e.g. Cardiologist"
                        value={form.specialization} onChange={handle} disabled={isLoading}
                        className="h-11 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground transition-all duration-200" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="experience" className="text-sm font-medium text-foreground">Years of experience</Label>
                      <Input id="experience" name="experience" type="number" min="0" placeholder="e.g. 10"
                        value={form.experience} onChange={handle} disabled={isLoading}
                        className="h-11 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground transition-all duration-200" />
                    </div>
                  </>
                )}

                {/* ── Lawyer-specific ───────────────────────────────────────────── */}
                {role === 'lawyer' && (
                  <div className="space-y-2">
                    <Label htmlFor="barNumber" className="text-sm font-medium text-foreground">Bar council number</Label>
                    <Input id="barNumber" name="barNumber" type="text" placeholder="e.g. PBC-12345"
                      value={form.barNumber} onChange={handle} disabled={isLoading}
                      className="h-11 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground transition-all duration-200" />
                  </div>
                )}

                {/* Password */}
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-medium text-foreground">
                    Password <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <Input id="password" name="password" type={showPw ? 'text' : 'password'}
                      placeholder="Min. 8 characters" value={form.password} onChange={handle} disabled={isLoading}
                      className="h-11 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground transition-all duration-200 pr-10" />
                    <button type="button" onClick={() => setShowPw(!showPw)} disabled={isLoading}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-sm font-medium text-foreground">
                    Confirm password <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <Input id="confirmPassword" name="confirmPassword" type={showCpw ? 'text' : 'password'}
                      placeholder="••••••••" value={form.confirmPassword} onChange={handle} disabled={isLoading}
                      className="h-11 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground transition-all duration-200 pr-10" />
                    <button type="button" onClick={() => setShowCpw(!showCpw)} disabled={isLoading}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      {showCpw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <Button type="submit" disabled={isLoading}
                  className="w-full h-11 rounded-lg bg-foreground text-background font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed mt-2">
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                      Submitting...
                    </span>
                  ) : 'Submit registration'}
                </Button>
              </form>
            </>
          )}

          {/* ── STEP 3 — Success ──────────────────────────────────────────────── */}
          {step === 'done' && (
            <div className={`text-center ${visible ? 'blur-in blur-in-delay-2' : ''}`}>
              <div className="mb-6 flex justify-center">
                <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-accent" />
                </div>
              </div>
              <h2 className="text-3xl font-serif font-normal tracking-tight text-foreground mb-3">
                {role === 'patient' ? 'Account created' : 'Registration submitted'}
              </h2>
              <p className="text-base font-light text-muted-foreground mb-6">
                {role === 'patient' ? (
                  <>Your <strong className="text-foreground">Patient</strong> account is ready. Log in to get started.</>
                ) : (
                  <>
                    Your <strong className="text-foreground">{ROLE_LABELS[role]}</strong> account is pending admin approval.
                    You'll be notified once it's reviewed.
                  </>
                )}
              </p>

              <div className="p-4 rounded-xl bg-muted border border-border text-left mb-8">
                <p className="text-xs font-semibold text-foreground mb-2">What happens next?</p>
                {role === 'patient' ? (
                  <ol className="space-y-1 text-xs text-muted-foreground list-decimal list-inside">
                    <li>Log in to search tests, compare labs and view your reports</li>
                    <li>Admin verifies your CNIC — you'll get a notification</li>
                    <li>Once verified, you can apply for community support and installment plans</li>
                  </ol>
                ) : (
                  <ol className="space-y-1 text-xs text-muted-foreground list-decimal list-inside">
                    <li>Admin reviews your registration details</li>
                    <li>You receive an approval or rejection notification</li>
                    <li>Once approved, you can log in and access your dashboard</li>
                  </ol>
                )}
              </div>

              <Button
                onClick={() => window.location.href = '/login'}
                className="w-full h-11 rounded-lg bg-foreground text-background font-medium hover:opacity-90 transition-opacity"
              >
                Go to login
              </Button>
            </div>
          )}

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
              Join the CareFirst network
            </h2>
            <p className="text-base font-light text-muted-foreground leading-relaxed">
              Connect with patients, manage your practice, and be part of a platform making healthcare accessible for everyone.
            </p>
          </div>
          <div className={`mt-8 space-y-4 ${visible ? 'blur-in blur-in-delay-3' : ''}`}>
            {[
              { title: 'Verified Platform',  desc: 'All accounts reviewed by admin' },
              { title: 'Transparent System', desc: 'Full audit trail for all actions' },
              { title: 'Real-time Updates',  desc: 'Instant notifications via Socket.IO' },
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
            Trusted by leading diagnostic labs across Pakistan
          </p>
        </div>
      </div>
    </div>
  );
}
