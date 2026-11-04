/** The brand mark: you at the warm centre, layers of protection around you. */
export function RingsMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true">
      <circle cx="15" cy="15" r="15" fill="#D3F4D1" />
      <circle cx="15" cy="15" r="10" fill="#ACDBB8" />
      <circle cx="15" cy="15" r="5" fill="#FFF6E6" />
    </svg>
  );
}
