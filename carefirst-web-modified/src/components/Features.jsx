import { useReveal } from "../hooks/useReveal";
import { T, IC } from "../theme/theme";
import { SectionHeader } from "./Shared";

export default function Features() {
  const features = [
    { icon: IC.Search, title: "True Cost Optimizer", desc: "Scans every partner lab and factors in travel distance to surface the genuinely cheapest total cost." },
    { icon: IC.Scale, title: "Installment Plans", desc: "Split expensive tests into monthly payments secured by a guarantor backed legal agreement." },
    { icon: IC.Heart, title: "Community Support", desc: "Verified low-income patients receive an authorization slip accepted at partner labs for fully funded care." },
    { icon: IC.Volume, title: "Urdu TTS Reports", desc: "Medical reports and legal agreements narrated in natural Urdu removing the language barrier." },
  ];

  return (
    <section style={{ maxWidth: 1160, margin: "0 auto", padding: "7rem 2rem" }}>
      <div style={{ marginBottom: "3.5rem" }}>
        <SectionHeader label="Platform" heading="Built on three pillars." sub="Accessibility, transparency, and legal security. We don't just facilitate tests we build trust." />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1px", background: T.border, border: `1px solid ${T.border}`, borderRadius: T.radius, overflow: "hidden", boxShadow: T.shadow }}>
        {features.map((f, i) => {
          const ref = useReveal();
          return (
            <div key={f.title} ref={ref} className={`reveal card-hover stagger-${i}`}
              style={{
                padding: "2.25rem 2rem",
                background: "rgba(255,255,255,0.72)",
                backdropFilter: "blur(16px) saturate(1.5)",
                WebkitBackdropFilter: "blur(16px) saturate(1.5)",
                cursor: "default",
                transition: "background 0.25s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(250,250,248,0.95)"}
              onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.72)"}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: "rgba(245,245,240,0.9)",
                backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
                border: `1px solid rgba(255,255,255,0.80)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: T.textSub, marginBottom: "1.5rem",
                boxShadow: "0 2px 8px rgba(0,0,0,0.06), 0 0 0 1px rgba(255,255,255,0.6) inset",
              }}>{f.icon}</div>
              <h3 style={{ fontFamily: "'DM Serif Display', serif", fontSize: "1.15rem", color: T.text, marginBottom: "0.6rem", letterSpacing: "-0.01em" }}>{f.title}</h3>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.85rem", fontWeight: 300, color: T.textSub, lineHeight: 1.7 }}>{f.desc}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
