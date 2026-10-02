import { useState, useEffect, useRef } from "react";
import { T } from "../theme/theme";

export function SectionHeader({ label, heading, sub, light = false }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.unobserve(el); } },
      { threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const c = light
    ? { label: "rgba(255,255,255,0.45)", heading: "#ffffff", sub: "rgba(255,255,255,0.55)" }
    : { label: T.textMuted, heading: T.text, sub: T.textSub };

  return (
    <div ref={ref}>
      {label && (
        <p className={visible ? "blur-in blur-in-delay-1" : ""}
          style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.22em", textTransform: "uppercase", color: c.label, marginBottom: "1rem" }}>
          {label}
        </p>
      )}
      <h2 className={visible ? "blur-in blur-in-delay-2" : ""}
        style={{ fontFamily: "'DM Serif Display', serif", fontSize: "clamp(2rem, 3.5vw, 2.85rem)", fontWeight: 400, color: c.heading, lineHeight: 1.18, letterSpacing: "-0.01em", marginBottom: sub ? "1rem" : 0, maxWidth: 560 }}>
        {heading}
      </h2>
      {sub && (
        <p className={visible ? "blur-in blur-in-delay-3" : ""} style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "1rem", color: c.sub, lineHeight: 1.72, maxWidth: 500 }}>
          {sub}
        </p>
      )}
    </div>
  );
}