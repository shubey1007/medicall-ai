export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <div className="brand-mark" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <line x1="4" y1="12" x2="4" y2="12" />
        <line x1="8" y1="9" x2="8" y2="15" />
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="16" y1="8" x2="16" y2="16" />
        <line x1="20" y1="11" x2="20" y2="13" />
      </svg>
    </div>
  );
}

export function BrandWord() {
  return (
    <div className="brand-word">
      MediCall<span className="ai">·AI</span>
    </div>
  );
}
