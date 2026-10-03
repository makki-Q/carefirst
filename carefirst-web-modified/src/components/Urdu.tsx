import React, { useEffect, useRef, useState } from 'react';
import { getSession } from '../lib/api';

// ── Urdu text and audio (Azure Speech via POST /api/tts) ──────────────────────

const VOICE_KEY = 'cf_urdu_voice';
const VOICES: { key: string; label: string }[] = [
  { key: 'uzma', label: 'Uzma' },
  { key: 'asad', label: 'Asad' },
];
const readVoice = () => { try { return localStorage.getItem(VOICE_KEY) || 'uzma'; } catch { return 'uzma'; } };
const saveVoice = (v: string) => { try { localStorage.setItem(VOICE_KEY, v); } catch {} };

// Keep left-to-right runs (CNICs, phone numbers, amounts, Latin names) in their own
// direction inside Urdu — otherwise "35202-1234567-1" displays as "1-1234567-35202"
const LTR_RUN = /[0-9][0-9,.\-/]*[0-9]|[A-Za-z][A-Za-z0-9 .,'\-]*[A-Za-z0-9]/g;
const isolateLtr = (text: string) => text.replace(LTR_RUN, m => `⁦${m}⁩`);

// Right-to-left Urdu block in a Nastaliq font
export const UrduText = ({ text, maxHeight, style }: { text: string; maxHeight?: number; style?: React.CSSProperties }) => (
  <div dir="rtl" lang="ur" style={{
    fontFamily: "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', serif", fontSize: '0.95rem', lineHeight: 2.1,
    whiteSpace: 'pre-wrap', textAlign: 'right', color: 'inherit',
    ...(maxHeight ? { maxHeight, overflowY: 'auto' } : {}), ...style,
  }}>{isolateLtr(text)}</div>
);

// What to read: a stored agreement or report, or the agreement preview before applying
export type SpeechSource =
  | { source: 'agreement' | 'report'; id: string }
  | { source: 'agreement-preview'; labId: string; testId: string; guarantor: any };

// "Listen in Urdu" with play / pause / stop and a voice choice.
// The server only ever speaks text it stores or generates itself.
export const ListenButton = ({ request, compact = false, label = 'Listen in Urdu' }: { request: SpeechSource; compact?: boolean; label?: string }) => {
  const [voice, setVoice]   = useState(readVoice);
  const [state, setState]   = useState<'idle' | 'loading' | 'playing' | 'paused'>('idle');
  const [error, setError]   = useState('');
  const audio = useRef<HTMLAudioElement | null>(null);
  const urls  = useRef<Record<string, string>>({}); // voice → object URL for this item
  const requestKey = JSON.stringify(request);

  const stop = () => {
    if (audio.current) { audio.current.pause(); audio.current.currentTime = 0; }
    setState('idle');
  };

  // New item → drop the old audio
  useEffect(() => {
    stop();
    Object.values(urls.current).forEach(u => URL.revokeObjectURL(u));
    urls.current = {};
    setError('');
  }, [requestKey]);

  useEffect(() => () => {
    audio.current?.pause();
    Object.values(urls.current).forEach(u => URL.revokeObjectURL(u));
  }, []);

  const play = async (v = voice) => {
    setError('');
    if (state === 'paused' && audio.current && v === voice) { audio.current.play(); setState('playing'); return; }
    try {
      if (!urls.current[v]) {
        setState('loading');
        const res = await fetch('/api/tts', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getSession().token}` },
          body:    JSON.stringify({ ...request, voice: v }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || 'Could not create the audio');
        }
        urls.current[v] = URL.createObjectURL(await res.blob());
      }
      audio.current?.pause();
      const a = new Audio(urls.current[v]);
      a.onended = () => setState('idle');
      a.onerror = () => { setState('idle'); setError('Could not play the audio'); };
      audio.current = a;
      await a.play();
      setState('playing');
    } catch (err: any) {
      setState('idle');
      setError(err.message || 'Could not play the audio');
    }
  };

  const pause = () => { audio.current?.pause(); setState('paused'); };

  const changeVoice = (v: string) => {
    setVoice(v); saveVoice(v);
    if (state === 'playing' || state === 'paused') play(v);
  };

  const btn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: compact ? '4px 10px' : '6px 14px', borderRadius: 20,
    fontSize: compact ? '0.72rem' : '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    border: '1px solid rgba(0,0,0,0.12)', background: '#fff', color: '#0d0d0d',
  };
  const speaker = (
    <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
    </svg>
  );

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {state === 'playing' ? (
        <button type="button" style={btn} onClick={pause}>❚❚ Pause</button>
      ) : (
        <button type="button" style={{ ...btn, opacity: state === 'loading' ? 0.6 : 1, cursor: state === 'loading' ? 'wait' : 'pointer' }}
          disabled={state === 'loading'} onClick={() => play()}>
          {speaker}{state === 'loading' ? 'Preparing audio…' : state === 'paused' ? 'Resume' : label}
        </button>
      )}
      {(state === 'playing' || state === 'paused') && <button type="button" style={btn} onClick={stop}>■ Stop</button>}
      <select value={voice} onChange={e => changeVoice(e.target.value)} title="Voice"
        style={{ ...btn, padding: compact ? '3px 6px' : '5px 8px', cursor: 'pointer' }}>
        {VOICES.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
      </select>
      {error && <span style={{ fontSize: '0.72rem', color: '#991b1b' }}>{error}</span>}
    </span>
  );
};
