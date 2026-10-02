import { T, IC } from "../theme/theme";
import { SectionHeader } from "./Shared";

export default function Testimonials() {
  const items = [
    { quote: "CareFirst found me an MRI lab 40% cheaper than the one my doctor recommended. The installment plan made it actually possible.", name: "Fatima Nawaz", role: "Patient, Lahore", service: "MRI & Imaging" },
    { quote: "The Urdu audio report feature is a game-changer. My elderly parents could finally understand what the doctor was saying.", name: "Ahmed Raza", role: "Patient, Faisalabad", service: "Biochemical Panel" },
    { quote: "Registering our lab on CareFirst doubled our walk-ins in three months. The booking and receipt system is completely seamless.", name: "Dr. Sara Malik", role: "Lab Director, Karachi", service: "Lab Partner" },
    { quote: "I was approved for community support within 48 hours. The process was dignified - no long queues or paperwork.", name: "Aisha Bibi", role: "Patient, Multan", service: "Community Support" },
    { quote: "The True Cost Optimizer saved my family Rs. 3,200 on a vitamin panel by routing us to a lab 8km away instead of the nearest.", name: "Tariq Mahmood", role: "Patient, Islamabad", service: "Vitamin Profile" },
    { quote: "Our doctors can now send digital prescriptions and track if patients completed their tests. It closes a huge gap in care.", name: "Dr. Kamran Ali", role: "Physician, Lahore", service: "Doctor Partner" },
  ];

  const doubled = [...items, ...items];
  const col1 = doubled.filter((_, i) => i % 3 === 0);
  const col2 = doubled.filter((_, i) => i % 3 === 1);
  const col3 = doubled.filter((_, i) => i % 3 === 2);

  const TestiCard = ({ t }) => (
    <div style={{
      background: "rgba(255,255,255,0.62)",
      backdropFilter: "blur(16px) saturate(1.5)",
      WebkitBackdropFilter: "blur(16px) saturate(1.5)",
      border: "1px solid rgba(255,255,255,0.75)",
      borderRadius: T.radius,
      padding: "1.75rem",
      marginBottom: "1.25rem",
      boxShadow: "0 0 0 1px rgba(255,255,255,0.4) inset, " + T.shadow,
    }}>
      <div style={{ display: "flex", gap: 2, marginBottom: "1rem" }}>
        {[...Array(5)].map((_, j) => <span key={j} style={{ color: "#F59E0B" }}>{IC.Star}</span>)}
      </div>
      <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: "0.98rem", fontStyle: "italic", fontWeight: 400, color: T.text, lineHeight: 1.65, marginBottom: "1.25rem" }}>&quot;{t.quote}&quot;</p>
      <div style={{ paddingTop: "1rem", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: "0.84rem", color: T.text }}>{t.name}</div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.75rem", color: T.textMuted, marginTop: 2 }}>{t.role}</div>
        </div>
        <span style={{
          padding: "0.2rem 0.6rem", borderRadius: 100,
          background: "rgba(245,245,240,0.8)",
          backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
          border: "1px solid rgba(255,255,255,0.7)",
          fontFamily: "'DM Sans', sans-serif", fontSize: "0.65rem", fontWeight: 500, color: T.textSub,
        }}>{t.service}</span>
      </div>
    </div>
  );

  return (
    <section style={{ maxWidth: 1160, margin: "0 auto", padding: "7rem 2rem" }}>
      <div style={{ marginBottom: "3.5rem" }}>
        <SectionHeader label="Testimonials" heading="Trusted across Pakistan." />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1.25rem", height: 620, overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 100, background: `linear-gradient(to bottom, ${T.bg}, transparent)`, zIndex: 10, pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 100, background: `linear-gradient(to top, ${T.bg}, transparent)`, zIndex: 10, pointerEvents: "none" }} />

        {[col1, col2, col3].map((col, ci) => (
          <div key={ci} className="testimonial-col" style={{ overflow: "hidden" }}>
            <div className={ci === 1 ? "scroll-up" : "scroll-down"}>
              {col.map((t, j) => <TestiCard key={j} t={t} />)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
