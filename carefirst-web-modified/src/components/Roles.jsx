import { useReveal } from "../hooks/useReveal";
import { T, IC } from "../theme/theme";
import { SectionHeader } from "./Shared";

export default function Roles() {
  const roles = [
    { title: "Patient", color: "#0284C7", perks: ["Search & compare labs", "Installment payments", "Urdu audio reports", "Community assistance"] },
    { title: "Doctor", color: "#7C3AED", perks: ["Digital prescriptions", "Manage schedule & fees", "View patient history", "Appointment tracking"] },
    { title: "Lab Admin", color: T.accentRed, perks: ["Publish test rates", "Verify receipts", "Upload results", "Manage charity quota"] },
    { title: "Platform Admin", color: T.text, perks: ["Approve support cases", "Manage all users", "Monitor wallet ledger", "Registration control"] },
    { title: "Lawyer", color: "#B45309", perks: ["Receive defaulter cases", "Review agreements", "Issue legal notices", "Handle disputes"] },
  ];

  return (
    <section id="community" style={{
      background: "rgba(250,250,248,0.6)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      borderTop: `1px solid ${T.border}`,
      borderBottom: `1px solid ${T.border}`,
    }}>
      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "7rem 2rem" }}>
        <div style={{ marginBottom: "3.5rem" }}>
          <SectionHeader label="Roles" heading="Built for every stakeholder." />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "1.25rem" }}>
          {roles.map((r, i) => {
            const ref = useReveal();
            return (
              <div key={r.title} ref={ref} className={`reveal card-hover stagger-${i}`} style={{
                background: "rgba(255,255,255,0.65)",
                backdropFilter: "blur(18px) saturate(1.4)",
                WebkitBackdropFilter: "blur(18px) saturate(1.4)",
                border: "1px solid rgba(255,255,255,0.75)",
                borderRadius: T.radius,
                padding: "1.75rem",
                boxShadow: "0 0 0 1px rgba(255,255,255,0.5) inset, " + T.shadow,
                display: "flex",
                flexDirection: "column",
              }}>
                <div style={{ width: 22, height: 3, borderRadius: 2, background: r.color, marginBottom: "1.25rem" }} />
                <h3 style={{ fontFamily: "'DM Serif Display', serif", fontSize: "1rem", fontWeight: 400, color: T.text, marginBottom: "1rem", letterSpacing: "-0.01em" }}>{r.title}</h3>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, flex: 1 }}>
                  {r.perks.map(p => (
                    <li key={p} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontFamily: "'DM Sans', sans-serif", fontSize: "0.8rem", fontWeight: 300, color: T.textSub, marginBottom: "0.5rem", lineHeight: 1.5 }}>
                      <span style={{ color: r.color, marginTop: 1, flexShrink: 0 }}>{IC.Check}</span>{p}
                    </li>
                  ))}
                </ul>
                {r.title === "Doctor" && (
                  <a href="/doctor-dashboard" style={{
                    marginTop: "1.5rem",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    color: r.color,
                    textDecoration: "none",
                    alignSelf: "flex-start",
                  }}>
                   
                    </a>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
