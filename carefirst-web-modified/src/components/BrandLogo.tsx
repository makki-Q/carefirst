import { useId } from 'react';

// CareFirst logo: the glossy red heart with the black pulse line, and the
// "CARE / First" wordmark beside it (drawn as SVG + text so it stays sharp).
export function BrandHeart({ size = 54 }: { size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <svg width={size} height={size * 62 / 72} viewBox="0 0 72 62" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <radialGradient id={`${id}-fill`} cx="0.38" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ff5b4f" />
          <stop offset="0.45" stopColor="#ef2a22" />
          <stop offset="1" stopColor="#c0141b" />
        </radialGradient>
        <radialGradient id={`${id}-shine`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path
        d="M36 57C33 54.5 7 38 7 20.5 7 11.5 13.5 5 21.5 5 28 5 33 8.8 36 14 39 8.8 44 5 50.5 5 58.5 5 65 11.5 65 20.5 65 38 39 54.5 36 57Z"
        fill={`url(#${id}-fill)`} stroke="#141414" strokeWidth="3" strokeLinejoin="round"
      />
      <ellipse cx="20" cy="15" rx="8" ry="5" transform="rotate(-28 20 15)" fill={`url(#${id}-shine)`} />
      <path
        d="M2 33H20.5L25 33 29.5 20.5 34.5 45 40.5 13 45 37 48.5 27.5 51.5 33H70"
        fill="none" stroke="#141414" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

export default function BrandLogo() {
  return (
    <div role="img" aria-label="CareFirst" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <BrandHeart />
      <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', color: '#0d0d0d', lineHeight: 1 }}>
        <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 9.5, letterSpacing: '0.42em', marginBottom: 3, paddingLeft: 1 }}>
          CARE
        </span>
        <span style={{ fontFamily: "'Abril Fatface', 'DM Serif Display', serif", fontSize: 29, letterSpacing: '0.005em', lineHeight: 0.92 }}>
          First
        </span>
      </div>
    </div>
  );
}
