import { useState, useRef, useEffect } from "react";
import { useReveal } from "../hooks/useReveal";
import { T, IC } from "../theme/theme";
import { SectionHeader } from "./Shared";

export default function TestCatalog() {
  const cats = ["All", "Clinical", "Blood", "Biochemical", "Hormonal", "Imaging"];
  const [active, setActive] = useState("All");
  const [visible, setVisible] = useState(true);
  const pillRef = useRef(null);
  const [pillStyle, setPillStyle] = useState({ left: 4, width: 40 });

  useEffect(() => {
    const container = pillRef.current;
    if (!container) return;
    const btns = container.querySelectorAll("button");
    const idx = cats.indexOf(active);
    if (btns[idx]) {
      const btn = btns[idx];
      setPillStyle({ left: btn.offsetLeft, width: btn.offsetWidth });
    }
  }, [active]);

  const handleCat = (cat) => {
    setVisible(false);
    setTimeout(() => { setActive(cat); setVisible(true); }, 180);
  };

  const tests = [
    { title: "MRI & Imaging", desc: "High-resolution scanning with 3 or 6-month installment plans across 8 partner labs.",  support: true, img: "https://images.unsplash.com/photo-1512069772995-ec65ed45afd6?w=600&auto=format&fit=crop&q=70" },
    { title: "Biochemical Panel", desc: "Comprehensive metabolic screening. True Cost Optimizer compares rates across 10+ labs.",  support: false, img: "https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?w=600&auto=format&fit=crop&q=70" },
    { title: "Vitamin Profile", desc: "Diagnose micronutrient deficiencies. Community support eligible for verified cases.",  support: true, img: "https://images.unsplash.com/photo-1512069772995-ec65ed45afd6?w=600&auto=format&fit=crop&q=70" },
    { title: "CBC Analysis", desc: "The fundamental health screening. Upload your payment receipt for instant confirmation.", support: false, img: "https://images.unsplash.com/photo-1607619056574-7b8d3ee536b2?w=600&auto=format&fit=crop&q=70" },
  ];

  return (
    <section id="test-rates" style={{ maxWidth: 1160, margin: "0 auto", padding: "7rem 2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "2rem", marginBottom: "2.5rem" }}>
        <SectionHeader label="Catalog" heading="Diagnostic tests." />
        <a href="#" style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "'DM Sans', sans-serif", fontSize: "0.84rem", fontWeight: 500, color: T.textSub, transition: "color 0.18s" }}
          onMouseEnter={e => e.currentTarget.style.color = T.text}
          onMouseLeave={e => e.currentTarget.style.color = T.textSub}
        >
          View all tests <span className="btn-arrow">{IC.ArrowR}</span>
        </a>
      </div>

      <div ref={pillRef} style={{ display: "inline-flex", padding: 4, borderRadius: 100, background: T.surface, border: `1px solid ${T.border}`, boxShadow: T.shadow, position: "relative", marginBottom: "2.5rem" }}>
        <div className="pill-bg" style={{ position: "absolute", top: 4, height: "calc(100% - 8px)", background: T.text, borderRadius: 100, pointerEvents: "none", left: pillStyle.left, width: pillStyle.width }} />
        {cats.map(c => (
          <button key={c} onClick={() => handleCat(c)} className="pill-tab"
            style={{ padding: "0.38rem 1rem", borderRadius: 100, fontFamily: "'DM Sans', sans-serif", fontSize: "0.8rem", fontWeight: 500, background: "none", color: active === c ? "#fff" : T.textSub, transition: "color 0.22s", position: "relative", zIndex: 1 }}>
            {c}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1.25rem", opacity: visible ? 1 : 0, transition: "opacity 0.18s ease" }}>
        {tests.map((t, i) => {
          const ref = useReveal();
          return (
            <div key={t.title} ref={ref} className={`reveal card-hover stagger-${i}`} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, overflow: "hidden", boxShadow: T.shadow, cursor: "pointer" }}>
              <div style={{ position: "relative", aspectRatio: "16/10", overflow: "hidden" }}>
                <img src={t.img} alt={t.title} style={{ width: "100%", height: "100%", objectFit: "cover", transition: "transform 0.5s ease" }}
                  onMouseEnter={e => e.currentTarget.style.transform = "scale(1.04)"}
                  onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                />
                {t.support && (
                  <span style={{ position: "absolute", top: 12, left: 12, padding: "0.22rem 0.65rem", borderRadius: 100, background: "rgba(201,55,44,0.9)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", fontFamily: "'DM Sans', sans-serif", fontSize: "0.65rem", fontWeight: 600, color: "#fff", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    Support eligible
                  </span>
                )}
              </div>
              <div style={{ padding: "1.4rem" }}>
                <h3 style={{ fontFamily: "'DM Serif Display', serif", fontSize: "1.05rem", fontWeight: 400, color: T.text, marginBottom: "0.45rem", letterSpacing: "-0.01em" }}>{t.title}</h3>
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.8rem", fontWeight: 300, color: T.textSub, lineHeight: 1.7, marginBottom: "1.1rem" }}>{t.desc}</p>
                <div style={{ paddingTop: "1rem", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.65rem", fontWeight: 500, color: T.textMuted, marginBottom: 3, letterSpacing: "0.04em" }}>Starting from</div>
                    <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: "1.1rem", fontWeight: 400, color: T.text }}>{t.price}</div>
                  </div>
                  <div style={{ width: 32, height: 32, borderRadius: 100, border: `1px solid ${T.border}`, background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", color: T.textSub, transition: "background 0.2s, border-color 0.2s" }}
                    onMouseEnter={e => { e.currentTarget.style.background = T.text; e.currentTarget.style.color = "#fff"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = T.bg; e.currentTarget.style.color = T.textSub; }}
                  >{IC.Plus}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
