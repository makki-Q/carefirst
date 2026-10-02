import { useReveal } from "../hooks/useReveal";
import { T, IC } from "../theme/theme";

export default function CTABanner() {
  const ref = useReveal(0.15);
  const pillars = [
    { icon: IC.Shield, text: "Legally-backed installments" },
    { icon: IC.Heart, text: "Community charity support" },
    { icon: IC.Search, text: "True cost transparency" },
  ];

  return (
    <section style={{ maxWidth: 1160, margin: "0 auto", padding: "0 2rem 7rem" }}>
      <div ref={ref} className="reveal" style={{ borderRadius: T.radius, minHeight: 420, position: "relative", overflow: "hidden", background: "#0d0d0d", boxShadow: T.shadow, display: "flex", alignItems: "center" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "url('https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=1400&auto=format&fit=crop&q=70')", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.22 }} />
        <div style={{ position: "absolute", inset: 0, opacity: 0.05, backgroundImage: "linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

        <div style={{ position: "relative", zIndex: 1, padding: "4rem", maxWidth: 720 }}>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: "1.25rem" }}>
            Get started today
          </p>
          <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: "clamp(2rem, 4vw, 3.2rem)", fontWeight: 400, color: "#fff", lineHeight: 1.15, letterSpacing: "-0.02em", marginBottom: "2.5rem" }}>
            Quality healthcare shouldn't be<br />
            <em style={{ color: "rgba(255,255,255,0.45)", fontStyle: "italic" }}>a privilege.</em>
          </h2>
          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", marginBottom: "3rem" }}>
            {pillars.map(p => (
              <div key={p.text} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.65)" }}>{p.icon}</div>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.85rem", fontWeight: 400, color: "rgba(255,255,255,0.65)" }}>{p.text}</span>
              </div>
            ))}
          </div>
          <button style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "0.9rem 2.25rem", borderRadius: 100, background: "#fff", color: T.text, fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: "0.92rem", boxShadow: "0 4px 20px rgba(0,0,0,0.25)", transition: "opacity 0.18s" }}
            onClick={() => window.location.href = '/login'}
            onMouseEnter={e => e.currentTarget.style.opacity = "0.88"}
            onMouseLeave={e => e.currentTarget.style.opacity = "1"}
          >
            Create your account <span className="btn-arrow">{IC.ArrowR}</span>
          </button>
        </div>
      </div>
    </section>
  );
}
