/** Generic page skeleton shown during route navigation (Next loading.tsx). */
export function PageSkeleton() {
  return (
    <div className="page">
      <div className="phead"><div className="skl skl-title" /></div>
      <div className="scroll" style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="skl skl-bar" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div className="skl skl-row" key={i} style={{ opacity: 1 - i * 0.07 }} />
        ))}
      </div>
    </div>
  );
}
