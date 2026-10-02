import { useState, useEffect } from "react";
import { T, IC } from "../theme/theme";

export default function Hero() {
  const [visible, setVisible] = useState(false);
  useEffect(() => { setTimeout(() => setVisible(true), 80); }, []);

  return (
    <section style={{ minHeight: "100vh", position: "relative", display: "flex", alignItems: "center", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, zIndex: 0, backgroundImage: "url('https://images.unsplash.com/photo-1631549916768-4119b2e5f926?w=1800&auto=format&fit=crop&q=80')", backgroundSize: "cover", backgroundPosition: "center 30%", filter: "saturate(0.7) brightness(0.92)" }} />
      <div style={{ position: "absolute", inset: 0, zIndex: 1, background: `linear-gradient(to top, ${T.bg} 0%, ${T.bg}cc 25%, rgba(245,245,240,0.45) 55%, transparent 100%)` }} />

      <div style={{ position: "relative", zIndex: 2, maxWidth: 1160, margin: "0 auto", padding: "0 2rem", paddingTop: "6rem" }}>
        <div style={{ maxWidth: 680 }}>
          {visible && (
            <p className="blur-in blur-in-delay-1" style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.25em", textTransform: "uppercase", color: T.accentRed, marginBottom: "1.5rem" }}>
              Pakistan's healthcare cost platform
            </p>
          )}

          {visible && (
            <h1 className="blur-in blur-in-delay-2" style={{ fontFamily: "'DM Serif Display', serif", fontSize: "clamp(3.2rem, 7vw, 6rem)", fontWeight: 400, lineHeight: 1.04, letterSpacing: "-0.02em", color: T.text, marginBottom: "1.75rem" }}>
              Healthcare that<br />
              <em style={{ color: "rgba(13,13,13,0.38)", fontStyle: "italic" }}>fits your budget.</em>
            </h1>
          )}

          {visible && (
            <p className="blur-in blur-in-delay-3" style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "1.1rem", fontWeight: 300, color: T.textSub, lineHeight: 1.75, maxWidth: 500, marginBottom: "2.5rem" }}>
              CareFirst bridges patients and diagnostic labs through transparent pricing, installment plans backed by legal agreements, and charity support for those who can't afford care.
            </p>
          )}

          {visible && (
            <div className="blur-in blur-in-delay-3" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "5rem" }}>
              <button style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.85rem 2rem", borderRadius: 100, background: T.text, color: "#fff", fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: "0.92rem", boxShadow: T.shadow, transition: "opacity 0.2s" }}
                onClick={() => window.location.href = '/login'}
                onMouseEnter={e => e.currentTarget.style.opacity = "0.84"}
                onMouseLeave={e => e.currentTarget.style.opacity = "1"}
              >
                Book a test <span className="btn-arrow">{IC.ArrowR}</span>
              </button>
              <button style={{ padding: "0.85rem 2rem", borderRadius: 100, border: `1px solid ${T.borderMd}`, background: "rgba(255,255,255,0.55)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: "0.92rem", color: T.text, transition: "background 0.2s, border-color 0.2s" }}
                onClick={() => window.location.href = '/login'}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.85)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.55)"; }}
              >
                Apply for support
              </button>
            </div>
          )}

          {visible && (
            <div className="blur-in blur-in-delay-3" style={{ display: "flex", alignItems: "center", gap: "2rem", flexWrap: "wrap" }}>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase", color: T.textMuted }}>Trusted by</span>
              {['Chugtai Lab', 'IDC', 'Excel labs', 'CitiLab', 'Shaukat Khanum'].map(l => (
                <span key={l} style={{ fontFamily: "'DM Serif Display', serif", fontSize: "0.9rem", color: "rgba(13,13,13,0.28)", letterSpacing: "-0.01em" }}>{l}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ position: "absolute", bottom: 40, left: "50%", transform: "translateX(-50%)", zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase", color: T.textMuted }}></span>
        <div style={{ width: 1, height: 48, background: T.border, borderRadius: 1, overflow: "hidden", position: "relative" }}>
         
        </div>
      </div>
    </section>
  );
}
