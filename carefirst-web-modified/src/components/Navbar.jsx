import { useState, useEffect } from "react";
import { T, IC, Logo } from "../theme/theme";

const NAV_LINKS = [
  { label: "How it works", id: "how-it-works" },
  { label: "Test Rates",   id: "test-rates"   },
  { label: "Community",    id: "community"     },
  { label: "Legal",        id: "legal"         },
];

const scrollTo = (id) => (e) => {
  e.preventDefault();
  const el = document.getElementById(id);
  if (!el) return;
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 88, behavior: "smooth" });
};

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <nav className="nav-enter" style={{
      position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
      width: "calc(100% - 48px)", maxWidth: 1160, zIndex: 100,
      height: 60, borderRadius: T.radius,
      background: scrolled ? "rgba(245,245,240,0.72)" : "rgba(255,255,255,0.28)",
      backdropFilter: "blur(22px) saturate(1.8)",
      WebkitBackdropFilter: "blur(22px) saturate(1.8)",
      border: scrolled ? "1px solid rgba(255,255,255,0.60)" : "1px solid rgba(255,255,255,0.45)",
      boxShadow: scrolled
        ? "0 0 0 1px rgba(255,255,255,0.12) inset, " + T.shadow
        : "0 0 0 1px rgba(255,255,255,0.20) inset",
      transition: "background 0.3s, box-shadow 0.3s, border-color 0.3s",
      display: "flex", alignItems: "center", padding: "0 1.5rem",
    }}>
      <div style={{ display: "flex", gap: "1.75rem", flex: 1 }}>
        {NAV_LINKS.map(({ label, id }) => (
          <a key={id} href={`#${id}`} onClick={scrollTo(id)} style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.84rem", fontWeight: 500, color: T.textSub, transition: "color 0.18s", textDecoration: "none" }}
            onMouseEnter={e => e.target.style.color = T.text} onMouseLeave={e => e.target.style.color = T.textSub}>{label}</a>
        ))}
      </div>
      <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)" }}><Logo /></div>
      <div style={{ display: "flex", gap: "0.55rem", flex: 1, justifyContent: "flex-end" }}>
        <button style={{
          padding: "0.42rem 1rem", borderRadius: 100,
          border: `1px solid rgba(255,255,255,0.55)`,
          background: "rgba(255,255,255,0.45)",
          backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
          fontFamily: "'DM Sans', sans-serif", fontSize: "0.83rem", fontWeight: 500, color: T.text, transition: "all 0.18s"
        }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.75)"; e.currentTarget.style.borderColor = T.borderMd; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.45)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.55)"; }}>Log in</button>
        <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "0.42rem 1.1rem", borderRadius: 100, background: T.text, color: "#fff", fontFamily: "'DM Sans', sans-serif", fontSize: "0.83rem", fontWeight: 500, boxShadow: T.shadow, transition: "opacity 0.18s" }}
          onMouseEnter={e => e.currentTarget.style.opacity = "0.85"} onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
          Get started <span className="btn-arrow">{IC.ChevR}</span>
        </button>
      </div>
    </nav>
  );
}
