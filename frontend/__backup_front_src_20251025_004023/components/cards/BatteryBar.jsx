export default function BatteryBar({
  value = 0,
  height = 26,
  width = 124, 
  outline = false,
  showPercent = false,
  cap = true,
  className = "",
}) {
  console.log(height);
  const pct = Math.max(0, Math.min(1, value));
  const h = `${height}px`;
  const w = `${width}px`; // <-- nova constante
  const frameBase =
    "relative inline-flex items-center justify-start rounded-[3px] border-2 overflow-hidden";
  const frameColor = outline ? "border-white/80 bg-transparent" : "border-white/70 bg-white/40";
  const capWidth = Math.max(4, Math.round(height * 0.05));

  return (
    <div className={`relative ${className}`} style={{ height: h }}>
      {/* corpo principal da bateria */}
      <div className={`${frameBase} ${frameColor}`} style={{ height: h, width: w }}>
        <div className="absolute inset-0 m-[2px] rounded-[2px] overflow-hidden">
          {!outline && <div className="absolute inset-0 bg-white/20" />}
          <div
            className="relative h-full bg-green-500 transition-[width] duration-300"
            style={{ width: `${pct * 100}%` }}
          />
        </div>
      </div>

      {/* tampinha da bateria */}
      {cap && (
        <div
          className="absolute top-1/2 -translate-y-1/2"
          style={{
            left: width, // encosta perfeitamente
            width: capWidth,
            height: Math.max(10, height * 0.6),
          }}
        >
          <div
            className={`h-full w-full rounded-r-[2px] ${outline ? "bg-white/80" : "bg-white/70"}`}
          />
        </div>
      )}

      {/* percentual central */}
      {showPercent && (
        <div
          className="absolute inset-0 grid place-items-center text-[11px] font-semibold text-white drop-shadow"
          style={{ width: w }}
        >
          {(pct * 100).toFixed(0)}%
        </div>
      )}
    </div>
  );
}