/** Static diagram of a fan-in ring: many unrelated senders → one new payee → fast outflow. Synthetic example. */
export function RingMap() {
  const cx = 250;
  const cy = 150;
  const victims = Array.from({ length: 12 }, (_, i) => {
    const a = Math.PI * (0.62 + (i / 11) * 0.76); // left-hand arc
    return { x: cx + Math.cos(a) * 190, y: cy - Math.sin(a) * 125, eleanor: i === 5 };
  });
  const mules = [
    { x: 455, y: 100 },
    { x: 455, y: 200 },
  ];
  return (
    <figure className="mt-4">
      <svg viewBox="-60 0 560 300" role="img" aria-labelledby="ring-title ring-desc" className="h-auto w-full">
        <title id="ring-title">Scam ring pattern</title>
        <desc id="ring-desc">Twelve unrelated accounts each pay one new account for the first time. That account sends most of the money on to two others within a day.</desc>
        <defs>
          <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 8 4 0 8z" fill="#6B3F06" />
          </marker>
        </defs>
        {victims.map((v, i) => (
          <line key={i} x1={v.x} y1={v.y} x2={cx} y2={cy} stroke={v.eleanor ? "#E9A94A" : "#ACDBB8"} strokeWidth={v.eleanor ? 2.5 : 1.5} strokeDasharray={v.eleanor ? "5 4" : undefined} />
        ))}
        {mules.map((m, i) => (
          <line key={i} x1={cx + 26} y1={cy} x2={m.x - 14} y2={m.y} stroke="#6B3F06" strokeWidth={2} markerEnd="url(#arr)" />
        ))}
        {victims.map((v, i) => (
          <circle key={i} cx={v.x} cy={v.y} r={v.eleanor ? 9 : 7} fill={v.eleanor ? "#E9A94A" : "#fff"} stroke={v.eleanor ? "#6B3F06" : "#2E5E45"} strokeWidth={2} />
        ))}
        <circle cx={cx} cy={cy} r={26} fill="#FCEFD9" stroke="#6B3F06" strokeWidth={2.5} />
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize="13" fontWeight="700" fill="#6B3F06">
          new
        </text>
        {mules.map((m, i) => (
          <rect key={i} x={m.x - 12} y={m.y - 12} width={24} height={24} rx={6} fill="#fff" stroke="#6B3F06" strokeWidth={2} />
        ))}
        <text x={victims[5]!.x} y={victims[5]!.y - 16} textAnchor="middle" fontSize="12" fontWeight="600" fill="#10241B">
          Eleanor’s paused payment
        </text>
        <text x={455} y={240} textAnchor="middle" fontSize="12" fill="#3E5248">
          moved out
        </text>
        <text x={455} y={256} textAnchor="middle" fontSize="12" fill="#3E5248">
          within a day
        </text>
      </svg>
      <figcaption className="sr-only">Example only. Built from synthetic data.</figcaption>
    </figure>
  );
}
