import { useReveal } from "../hooks/useReveal";
import { T } from "../theme/theme";

export default function StatsBand() {
  const stats = [
    { value: "100+", label: "Partner labs" },
    { value: "1200+", label: "Patients served" },
    { value: "Rs. 1.4lakh", label: "Tests facilitated" },
    { value: "98%", label: "Report accuracy" },
    { value: "3×", label: "Avg. cost savings" },
  ];

  return (
    <section style={{
      background: "rgba(255,255,255,0.55)",
      backdropFilter: "blur(20px) saturate(1.6)",
      WebkitBackdropFilter: "blur(20px) saturate(1.6)",
      borderTop: "1px solid rgba(255,255,255,0.7)",
      borderBottom: "1px solid rgba(255,255,255,0.5)",
      boxShadow: "0 1px 0 rgba(255,255,255,0.8) inset",
    }}>
      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "3rem 2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-around", flexWrap: "wrap", gap: "2.5rem" }}>
          {stats.map((s, i) => {
            const ref = useReveal();
            return (
              <div key={s.label} ref={ref} className={`reveal stagger-${i}`} style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: "2.2rem", color: T.text, letterSpacing: "-0.04em", lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.78rem", color: T.textMuted, marginTop: 6, letterSpacing: "0.02em" }}>{s.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
