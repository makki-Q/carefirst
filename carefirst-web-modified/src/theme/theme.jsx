export const T = {
  bg: "#f5f5f0", bgAlt: "#fafaf8", surface: "#ffffff",
  border: "rgba(0,0,0,0.06)", borderMd: "rgba(0,0,0,0.10)",
  text: "#0d0d0d", textSub: "rgba(13,13,13,0.65)", textMuted: "rgba(13,13,13,0.38)",
  accent: "#0d0d0d", accentRed: "#c9372c",
  shadow: `rgba(14,63,126,0.04) 0px 0px 0px 1px, rgba(42,51,69,0.04) 0px 1px 1px -0.5px, rgba(42,51,70,0.04) 0px 3px 3px -1.5px, rgba(42,51,70,0.04) 0px 6px 6px -3px, rgba(14,63,126,0.04) 0px 12px 12px -6px, rgba(14,63,126,0.04) 0px 24px 24px -12px`,
  shadowHover: `rgba(14,63,126,0.06) 0px 0px 0px 1px, rgba(42,51,69,0.06) 0px 1px 1px -0.5px, rgba(42,51,70,0.06) 0px 3px 3px -1.5px, rgba(42,51,70,0.07) 0px 8px 8px -4px, rgba(14,63,126,0.06) 0px 16px 16px -8px, rgba(14,63,126,0.06) 0px 32px 32px -16px`,
  radius: "22px", radiusSm: "14px",
};

export const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
  body { background: ${T.bg}; font-family: 'DM Sans', sans-serif; overflow-x: hidden; }
  ::selection { background: #d4e4f7; color: #0a2540; }
  a { text-decoration: none; color: inherit; }
  button { font-family: inherit; cursor: pointer; border: none; }
  @keyframes blur-in { 0% { filter: blur(10px); opacity: 0; transform: translateY(10px); } 100% { filter: blur(0); opacity: 1; transform: translateY(0); } }
  .blur-in { animation: blur-in 0.75s ease-out forwards; opacity: 0; }
  .blur-in-delay-1 { animation-delay: 0.2s; }
  .blur-in-delay-2 { animation-delay: 0.4s; }
  .blur-in-delay-3 { animation-delay: 0.6s; }
  .reveal { opacity: 0; transform: translateY(18px) scale(0.98); transition: opacity 0.65s ease-out, transform 0.65s ease-out; }
  .reveal.visible { opacity: 1; transform: translateY(0) scale(1); }
  .stagger-0 { transition-delay: 0ms; } .stagger-1 { transition-delay: 80ms; } .stagger-2 { transition-delay: 160ms; } .stagger-3 { transition-delay: 240ms; }
  @keyframes scroll-down { 0% { transform: translateY(0); } 100% { transform: translateY(-50%); } }
  @keyframes scroll-up { 0% { transform: translateY(-50%); } 100% { transform: translateY(0); } }
  .scroll-down { animation: scroll-down 34s linear infinite; }
  .scroll-up { animation: scroll-up 34s linear infinite; }
  .testimonial-col:hover .scroll-down, .testimonial-col:hover .scroll-up { animation-duration: 80s; }
  @keyframes scroll-line { 0%, 100% { transform: scaleY(0); transform-origin: top; } 40% { transform: scaleY(1); transform-origin: top; } 60% { transform: scaleY(1); transform-origin: bottom; } 100% { transform: scaleY(0); transform-origin: bottom; } }
  .scroll-line { animation: scroll-line 2s ease-in-out infinite; }
  .card-hover { transition: transform 0.28s ease-out, box-shadow 0.28s ease-out, border-color 0.2s; }
  .card-hover:hover { transform: translateY(-3px) scale(1.012); }
  .btn-arrow { transition: transform 0.25s ease-out; display: inline-flex; }
  button:hover .btn-arrow, a:hover .btn-arrow { transform: translateX(3px); }
  @keyframes nav-in { from { opacity: 0; transform: translateY(-8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
  .nav-enter { animation: nav-in 0.5s ease-out forwards; }
  .pill-tab { position: relative; z-index: 1; transition: color 0.25s ease-out; }
  .pill-bg { transition: left 0.28s cubic-bezier(0.34,1.56,0.64,1), width 0.28s cubic-bezier(0.34,1.56,0.64,1); }
`;

export const IC = {
  Search: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>,
  Scale: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 6h18M7 12h10M10 18h4"/></svg>,
  Heart: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
  Volume: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>,
  Check: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.25" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>,
  ArrowR: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>,
  ChevR: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>,
  HLogo: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
  Twitter: <svg width="15" height="15" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>,
  Linkedin:<svg width="15" height="15" fill="currentColor" viewBox="0 0 24 24"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z"/><circle cx="4" cy="4" r="2"/></svg>,
  Github: <svg width="15" height="15" fill="currentColor" viewBox="0 0 24 24"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>,
  Shield: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  File: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  Star: <svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
};

export const Logo = ({ light = false }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
    <div style={{ width: 28, height: 28, borderRadius: 8, background: light ? "rgba(255,255,255,0.18)" : T.text, border: light ? "1px solid rgba(255,255,255,0.25)" : "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {IC.HLogo}
    </div>
    <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: "1.15rem", fontWeight: 400, letterSpacing: "-0.01em", color: light ? "#fff" : T.text }}>carefirst</span>
  </div>
);