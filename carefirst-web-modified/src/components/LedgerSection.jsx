import { useReveal } from "../hooks/useReveal";
import { T, IC } from "../theme/theme";
import { SectionHeader } from "./Shared";

export default function LedgerSection() {
  const pillars = [
    { icon: IC.File, title: "Direct payments", desc: "We never handle your money. Pay the lab directly via cash or bank transfer, then upload your receipt as proof." },
    { icon: IC.Shield, title: "Zamanati system", desc: "Every installment plan is secured by a local guarantor, protecting labs from defaulters and patients from over-commitment." },
    { icon: IC.Scale, title: "Legal guard", desc: "Missed payments trigger automated case forwarding to our platform lawyer for offline recovery transparently enforced." },
  ];

  return (
    <section id="legal" style={{ background: T.surface, borderTop: `1px solid ${T.border}` }}>
      {/* Background image layer */}
      <div style={{
        position: "relative",
        backgroundImage: "url('https://images.unsplash.com/photo-1516549655169-df83a0774514?w=1800&auto=format&fit=crop&q=80')",
        backgroundSize: "cover",
        backgroundPosition: "center 40%",
        backgroundAttachment: "fixed",
      }}>
        {/* Overlay to blend with site palette */}
        <div style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(135deg, rgba(245,245,240,0.92) 0%, rgba(245,245,240,0.78) 100%)",
          zIndex: 0,
        }} />

        <div style={{ position: "relative", zIndex: 1, maxWidth: 1160, margin: "0 auto", padding: "7rem 2rem" }}>
          <div ref={useReveal()} className="reveal">
            {/* Glassmorphism card — the dark ledger box */}
            <div style={{
              background: "rgba(10,10,10,0.78)",
              backdropFilter: "blur(28px)",
              WebkitBackdropFilter: "blur(28px)",
              borderRadius: T.radius,
              padding: "4rem 4.5rem",
              position: "relative",
              overflow: "hidden",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.45), 0 32px 80px rgba(0,0,0,0.25)",
              border: "1px solid rgba(255,255,255,0.10)",
            }}>
              {/* Subtle grid texture */}
              <div style={{ position: "absolute", inset: 0, opacity: 0.04, backgroundImage: "linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)", backgroundSize: "36px 36px" }} />
              {/* Glow orb */}
              <div style={{ position: "absolute", top: -100, right: -100, width: 400, height: 400, borderRadius: "50%", background: `radial-gradient(circle, ${T.accentRed}22 0%, transparent 70%)`, pointerEvents: "none" }} />

              <div style={{ position: "relative", zIndex: 1 }}>
                <div style={{ maxWidth: 520, marginBottom: "3.5rem" }}>
                  <SectionHeader light label="Platform architecture" heading="The secure ledger framework." sub="Designed for direct payments and full legal accountability a sustainable ecosystem for patients, labs, and the platform." />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "3rem", marginBottom: "3.5rem" }}>
                  {pillars.map((p, i) => {
                    const ref = useReveal();
                    return (
                      <div key={p.title} ref={ref} className={`reveal stagger-${i}`}>
                        {/* Glassmorphism pillar icon box */}
                        <div style={{
                          width: 38, height: 38, borderRadius: 10,
                          background: "rgba(255,255,255,0.06)",
                          backdropFilter: "blur(12px)",
                          WebkitBackdropFilter: "blur(12px)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "rgba(255,255,255,0.55)", marginBottom: "1.25rem",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                        }}>{p.icon}</div>
                        <h3 style={{ fontFamily: "'DM Serif Display', serif", fontSize: "1.05rem", fontWeight: 400, color: "#F9FAFB", marginBottom: "0.5rem" }}>{p.title}</h3>
                        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.83rem", fontWeight: 300, color: "rgba(255,255,255,0.38)", lineHeight: 1.7 }}>{p.desc}</p>
                      </div>
                    );
                  })}
                </div>

                <div style={{ paddingTop: "2.5rem", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1.5rem" }}>
                  <div>
                    <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: "1.1rem", fontWeight: 400, color: "#F9FAFB", marginBottom: 4 }}>Ready to get started?</p>
                    <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.83rem", fontWeight: 300, color: "rgba(255,255,255,0.38)" }}>Join over 2,000 patients already on CareFirst.</p>
                  </div>
                  <button style={{ padding: "0.75rem 1.75rem", borderRadius: 100, background: "#fff", color: T.text, fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: "0.88rem", transition: "opacity 0.18s" }}
                    onClick={() => window.location.href = '/login'}
                    onMouseEnter={e => e.currentTarget.style.opacity = "0.86"}
                    onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                  >Create account</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
