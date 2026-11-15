// Shared building blocks: buttons, cards, the pill drawing, dialogs, toasts and date helpers.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { X, Syringe, Droplet, Wind, FlaskConical, LoaderCircle } from 'lucide-react';

// ---------------------------------------------------------------- formatting

export function niceTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  let hour = h % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function clock(ms) {
  const d = new Date(ms);
  return niceTime(`${d.getHours()}:${d.getMinutes()}`);
}

export function dayDate(ms, lang = 'en', opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Date(ms).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', opts);
}

export function timeAgo(ms) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

// Whole calendar days from today until a timestamp.
export function daysUntil(ms) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const target = new Date(ms);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - start) / 86400000);
}

export function durationText(ms, lang = 'en') {
  const mins = Math.max(0, Math.round(ms / 60000));
  const hr = lang === 'hi' ? 'घंटे' : 'hr';
  const min = lang === 'hi' ? 'मिनट' : 'min';
  if (mins < 60) return `${mins} ${min}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} ${hr} ${m} ${min}` : `${h} ${hr}`;
}

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

// ---------------------------------------------------------------- pills

export const PILL_COLORS = {
  white: '#F6F3EC', yellow: '#F2C94C', pink: '#F4A7B9', orange: '#F2994A', blue: '#7FB2E5',
  green: '#8BC98F', red: '#E57373', brown: '#A47551', purple: '#B39DDB',
};

// Draws the medicine the way it looks, because people remember "the small pink one", not the name.
export function PillIcon({ color = 'white', shape = 'round', form = 'tablet', size = 40 }) {
  const fill = PILL_COLORS[color] || PILL_COLORS.white;
  const stroke = 'rgba(30,42,45,0.28)';
  if (form === 'injection') return <Syringe size={size * 0.8} className="text-calm-600" aria-hidden />;
  if (form === 'drops') return <Droplet size={size * 0.8} className="text-calm-600" aria-hidden />;
  if (form === 'inhaler') return <Wind size={size * 0.8} className="text-calm-600" aria-hidden />;
  if (form === 'syrup') return <FlaskConical size={size * 0.8} className="text-sun-600" aria-hidden />;
  if (form === 'capsule') {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
        <g transform="rotate(-30 20 20)">
          <rect x="4" y="13" width="32" height="14" rx="7" fill="#fff" stroke={stroke} strokeWidth="1.2" />
          <path d="M11 13h9v14h-9a7 7 0 0 1 0-14z" fill={fill} stroke={stroke} strokeWidth="1.2" />
          <rect x="8" y="16" width="8" height="2.5" rx="1.25" fill="#fff" opacity="0.55" />
        </g>
      </svg>
    );
  }
  if (shape === 'oval') {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
        <ellipse cx="20" cy="20" rx="16" ry="10" fill={fill} stroke={stroke} strokeWidth="1.2" />
        <ellipse cx="15" cy="16" rx="6" ry="2.2" fill="#fff" opacity="0.5" />
      </svg>
    );
  }
  if (shape === 'oblong') {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
        <rect x="3" y="12" width="34" height="16" rx="8" fill={fill} stroke={stroke} strokeWidth="1.2" />
        <line x1="20" y1="14" x2="20" y2="26" stroke={stroke} strokeWidth="1.2" />
        <rect x="8" y="15" width="8" height="2.5" rx="1.25" fill="#fff" opacity="0.55" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="20" r="13" fill={fill} stroke={stroke} strokeWidth="1.2" />
      <line x1="11" y1="20" x2="29" y2="20" stroke={stroke} strokeWidth="1.1" />
      <ellipse cx="15.5" cy="14.5" rx="4" ry="2" fill="#fff" opacity="0.55" />
    </svg>
  );
}

// ---------------------------------------------------------------- basics

const VARIANTS = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 shadow-sm',
  secondary: 'bg-white text-ink border border-line-2 hover:bg-paper-2',
  ghost: 'text-brand-700 hover:bg-brand-50',
  soft: 'bg-brand-50 text-brand-800 hover:bg-brand-100',
  success: 'bg-ok-600 text-white hover:bg-ok-800 shadow-sm',
  danger: 'bg-bad-600 text-white hover:bg-bad-800 shadow-sm',
  dangerOutline: 'bg-white text-bad-600 border-2 border-bad-500 hover:bg-bad-50',
  sun: 'bg-sun-500 text-white hover:bg-sun-600 shadow-sm',
};
const SIZES = {
  sm: 'min-h-9 px-3 text-sm rounded-lg',
  md: 'min-h-11 px-4 text-[15px] rounded-xl',
  lg: 'min-h-14 px-6 text-lg rounded-2xl',
  xl: 'min-h-[4.25rem] px-6 text-[1.35rem] rounded-2xl',
};

export function Button({ variant = 'primary', size = 'md', className = '', busy = false, children, ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-semibold transition active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      disabled={busy || props.disabled}
      {...props}
    >
      {busy ? <LoaderCircle className="animate-spin" size={18} aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Card({ className = '', children, ...props }) {
  return (
    <div className={`bg-card border border-line rounded-2xl shadow-soft ${className}`} {...props}>
      {children}
    </div>
  );
}

export function Badge({ tone = 'gray', children, className = '' }) {
  const tones = {
    gray: 'bg-paper-2 text-ink-2', brand: 'bg-brand-50 text-brand-800', ok: 'bg-ok-50 text-ok-800',
    bad: 'bg-bad-50 text-bad-800', sun: 'bg-sun-50 text-sun-800', calm: 'bg-calm-50 text-calm-800', dusk: 'bg-dusk-50 text-dusk-800',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]} ${className}`}>{children}</span>;
}

export function Avatar({ name, size = 36, tone = 'brand' }) {
  const tones = { brand: 'bg-brand-100 text-brand-800', sun: 'bg-sun-100 text-sun-800', dusk: 'bg-dusk-100 text-dusk-800', calm: 'bg-calm-100 text-calm-800' };
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${tones[tone]}`} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-ink-3" role="status">
      <LoaderCircle className="animate-spin" size={22} aria-hidden /> {label}
    </div>
  );
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="hint block">{hint}</span> : null}
    </label>
  );
}

export function Modal({ open, onClose, title, children, wide = false, footer = null }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/40 p-0 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`animate-rise w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} max-h-[92vh] overflow-y-auto bg-paper rounded-t-3xl sm:rounded-3xl shadow-lift`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 bg-paper/95 backdrop-blur px-6 pt-5 pb-3 border-b border-line">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-paper-2" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer ? <div className="sticky bottom-0 bg-paper/95 backdrop-blur border-t border-line px-6 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <p role="alert" className="rounded-xl bg-bad-50 px-4 py-3 text-sm font-medium text-bad-800">{error}</p>;
}

// ---------------------------------------------------------------- toasts

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const show = useCallback((message, options = {}) => {
    clearTimeout(timer.current);
    setToast({ message, ...options, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), options.duration || 4500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? (
        <div className="fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 pointer-events-none" aria-live="polite">
          <div key={toast.id} className={`animate-rise pointer-events-auto flex items-center gap-4 rounded-2xl px-5 py-3.5 shadow-lift ${toast.tone === 'bad' ? 'bg-bad-800 text-white' : 'bg-ink text-white'} ${toast.big ? 'text-lg' : 'text-[15px]'}`}>
            <span className="font-semibold">{toast.message}</span>
            {toast.action ? (
              <button className="rounded-lg bg-white/15 px-3 py-1.5 font-bold hover:bg-white/25" onClick={() => { toast.action.onClick(); setToast(null); }}>
                {toast.action.label}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// Re-fetches data every few seconds so family dashboards update live.
export function usePolling(load, ms, deps = []) {
  useEffect(() => {
    let alive = true;
    const run = () => { if (alive) load(); };
    run();
    const id = setInterval(() => { if (document.visibilityState === 'visible') run(); }, ms);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export const PART_STYLE = {
  morning: { bg: 'bg-sun-50', ring: 'border-sun-100', text: 'text-sun-800', dot: 'bg-sun-500' },
  afternoon: { bg: 'bg-calm-50', ring: 'border-calm-100', text: 'text-calm-800', dot: 'bg-calm-600' },
  evening: { bg: 'bg-dusk-50', ring: 'border-dusk-100', text: 'text-dusk-800', dot: 'bg-dusk-600' },
  night: { bg: 'bg-night-50', ring: 'border-night-100', text: 'text-night-800', dot: 'bg-night-600' },
};
