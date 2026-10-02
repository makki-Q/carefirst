import { useReveal } from "../hooks/useReveal";
import { T, IC } from "../theme/theme";
import { SectionHeader } from "./Shared";

export default function HowItWorks() {
  const steps = [
    { num: "01", title: "Register & verify", desc: "Create an account with CNIC verification. Patients, doctors, and labs get custom dashboards." },
    { num: "02", title: "Search & compare", desc: "Find your prescribed test. The True Cost Optimizer ranks every lab by total cost." },
    { num: "03", title: "Book & pay", desc: "Choose full payment or installments. Pay the lab directly and upload your receipt." },
    { num: "04", title: "Receive your report", desc: "Lab uploads results. View online, share with your doctor, and listen to a full Urdu audio narration." },
  ];

  return (
    <section id="how-it-works" style={{ background: T.surface, borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "7rem 2rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5rem", alignItems: "start" }}>
          <div style={{ position: "sticky", top: 100 }}>
            <SectionHeader label="Process" heading="From search to report in four steps." sub="No cash handled on our end. Just a transparent, legally-backed process." />
            <button style={{ marginTop: "2rem", display: "inline-flex", alignItems: "center", gap: 8, padding: "0.8rem 1.75rem", borderRadius: 100, background: T.text, color: "#fff", fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: "0.88rem", boxShadow: T.shadow, transition: "opacity 0.18s" }} onClick={() => window.location.href = '/login'} onMouseEnter={e => e.currentTarget.style.opacity = "0.82"} onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
              See how it works <span className="btn-arrow">{IC.ArrowR}</span>
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0px" }}>
            {steps.map((s, i) => {
              const ref = useReveal();
              return (
                <div key={s.num} ref={ref} className={`reveal stagger-${i}`} style={{ padding: "2rem 0", borderBottom: i < steps.length - 1 ? `1px solid ${T.border}` : "none" }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.1em", color: T.accentRed, marginBottom: "0.75rem" }}>{s.num}</div>
                  <h3 style={{ fontFamily: "'DM Serif Display', serif", fontSize: "1.2rem", color: T.text, marginBottom: "0.5rem", letterSpacing: "-0.01em" }}>{s.title}</h3>
                  <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.86rem", fontWeight: 300, color: T.textSub, lineHeight: 1.7 }}>{s.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}