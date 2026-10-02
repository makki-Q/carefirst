import { T, IC, Logo } from "../theme/theme";

export default function Footer() {
  const scrollTo = (id) => (e) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 88, behavior: "smooth" });
  };

  const cols = [
    {
      heading: "Platform",
      links: [
        { label: "How it works",     action: scrollTo("how-it-works") },
        { label: "Test rates",       action: scrollTo("test-rates")   },
        { label: "Community support",action: scrollTo("community")    },
        { label: "Legal framework",  action: scrollTo("legal")        },
      ],
    },
    { heading: "Support", links: [
        { label: "Help center"    },
        { label: "Contact us"     },
        { label: "Privacy policy" },
        { label: "Terms of service" },
      ],
    },
    { heading: "Company", links: [
        { label: "About"   },
        { label: "Blog"    },
        { label: "Careers" },
        { label: "Press"   },
      ],
    },
  ];

  return (
    <footer style={{ background: T.bg, borderTop: `1px solid ${T.border}`, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", bottom: -30, left: "50%", transform: "translateX(-50%)", fontSize: "clamp(80px,18vw,220px)", fontFamily: "'DM Serif Display', serif", fontWeight: 400, color: T.text, opacity: 0.035, whiteSpace: "nowrap", pointerEvents: "none", userSelect: "none", lineHeight: 1 }}>
        carefirst
      </div>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1160, margin: "0 auto", padding: "4rem 2rem 2rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "3rem", marginBottom: "3rem" }}>
          <div>
            <div style={{ marginBottom: "1.25rem" }}><Logo /></div>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.84rem", fontWeight: 300, color: T.textSub, lineHeight: 1.75, maxWidth: 280, marginBottom: "1.5rem" }}>
              Accessible healthcare diagnostics in Pakistan. Bridging the gap through transparency and community.
            </p>
            <div style={{ display: "flex", gap: "0.6rem" }}>
              {[IC.Twitter, IC.Linkedin, IC.Github].map((ic, i) => (
                <div key={i} style={{ width: 34, height: 34, borderRadius: "50%", background: T.surface, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: T.textMuted, cursor: "pointer", transition: "color 0.18s, border-color 0.18s", boxShadow: T.shadow }}
                  onMouseEnter={e => { e.currentTarget.style.color = T.text; e.currentTarget.style.borderColor = T.borderMd; }}
                  onMouseLeave={e => { e.currentTarget.style.color = T.textMuted; e.currentTarget.style.borderColor = T.border; }}
                >{ic}</div>
              ))}
            </div>
          </div>

          {cols.map(col => (
            <div key={col.heading}>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.7rem", fontWeight: 600, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: "1.25rem" }}>{col.heading}</p>
              {col.links.map(({ label, action }) => (
                <a key={label} href={action ? "#" : undefined} onClick={action || undefined}
                  style={{ display: "block", fontFamily: "'DM Sans', sans-serif", fontSize: "0.84rem", fontWeight: 300, color: T.textSub, marginBottom: "0.65rem", transition: "color 0.15s", textDecoration: "none", cursor: action ? "pointer" : "default" }}
                  onMouseEnter={e => e.target.style.color = T.text}
                  onMouseLeave={e => e.target.style.color = T.textSub}
                >{label}</a>
              ))}
            </div>
          ))}
        </div>

        <div style={{ height: 1, background: T.border, marginBottom: "1.5rem" }} />
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.76rem", fontWeight: 300, color: T.textMuted }}>© 2026 CareFirst. FYP · M.Makki · Ali Anjum · Umar Maqbool · FAST-NUCES Chiniot</p>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.76rem", fontWeight: 300, color: T.textMuted }}>Designed for accessible healthcare in Pakistan.</p>
        </div>
      </div>
    </footer>
  );
}
