import { useState, useEffect } from "react";
import { T, GLOBAL_CSS } from "./theme/theme";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import StatsBand from "./components/StatsBand";
import Features from "./components/Features";
import HowItWorks from "./components/HowItWorks";
import TestCatalog from "./components/TestCatalog";
import Roles from "./components/Roles";
import Testimonials from "./components/Testimonials";
import CTABanner from "./components/CTABanner";
import LedgerSection from "./components/LedgerSection";
import Footer from "./components/Footer";

// Auth Pages
import "./auth/index.css";
import Login from "./auth/pages/Login";
import SignUp from "./auth/pages/SignUp";
import ForgotPassword from "./auth/pages/ForgotPassword";
import DoctorDashboard from "./pages/DoctorDashboard";
import PatientDashboard from "./pages/PatientDashboard";
import LabDashboard from "./pages/LabDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import LawyerDashboard from "./pages/LawyerDashboard";

export default function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname);

  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  if (currentPath === "/login") return <Login />;
  if (currentPath === "/signup" || currentPath === "/sign-up") return <SignUp />;
  if (currentPath === "/forgot-password") return <ForgotPassword />;
  if (currentPath === "/doctor-dashboard") return <DoctorDashboard />;
  if (currentPath === "/patient-dashboard") return <PatientDashboard />;
  if (currentPath === "/lab-dashboard") return <LabDashboard />;
  if (currentPath === "/admin-dashboard") return <AdminDashboard />;
  if (currentPath === "/lawyer-dashboard") return <LawyerDashboard />;

  return (
    <div style={{ background: T.bg, color: T.text, minHeight: "100vh", overflowX: "hidden" }}>
      <style>{GLOBAL_CSS}</style>
      <Navbar />
      <main>
        <Hero />
        <StatsBand />
        <Features />
        <HowItWorks />
        <TestCatalog />
        <Roles />
        <Testimonials />
        <CTABanner />
        <LedgerSection />
      </main>
      <Footer />
    </div>
  );
}
