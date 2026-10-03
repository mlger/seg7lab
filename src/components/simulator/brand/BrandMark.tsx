/**
 * SEG7 Lab brand mark — "the lit 8".
 *
 * All seven segments on (the everything-lit state every decoder passes
 * through) rendered in the signal phosphor; the decimal point in learn
 * amber. Colors come from the brand token layer (globals.css), so the
 * mark adapts to Bench (dark) and Datasheet (light) automatically.
 *
 * The geometry is hand-authored seven-segment lettering — hexagonal
 * segment tips, uniform mitered gaps — matching the displays simulated
 * inside the app. Decorative by design: always rendered next to a
 * visible text label, hence aria-hidden.
 */

const SEGMENTS: { id: string; d: string }[] = [
  // a — top
  { id: 'a', d: 'M34 23 L41 16 L83 16 L90 23 L83 30 L41 30 Z' },
  // g — middle
  { id: 'g', d: 'M34 96 L41 89 L83 89 L90 96 L83 103 L41 103 Z' },
  // d — bottom
  { id: 'd', d: 'M34 169 L41 162 L83 162 L90 169 L83 176 L41 176 Z' },
  // f — upper left
  { id: 'f', d: 'M29 21 L36 28 L36 84 L29 91 L22 84 L22 28 Z' },
  // b — upper right
  { id: 'b', d: 'M95 21 L102 28 L102 84 L95 91 L88 84 L88 28 Z' },
  // e — lower left
  { id: 'e', d: 'M29 101 L36 108 L36 164 L29 171 L22 164 L22 108 Z' },
  // c — lower right
  { id: 'c', d: 'M95 101 L102 108 L102 164 L95 171 L88 164 L88 108 Z' },
];

export function Seg7Mark({
  className,
  glow = true,
}: {
  className?: string;
  /** phosphor glow — disable for tiny sizes where it would smear */
  glow?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 124 192"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <g className={glow ? 'seg-glow' : undefined}>
        <g className="fill-brand-signal">
          {SEGMENTS.map((s) => (
            <path key={s.id} d={s.d} />
          ))}
        </g>
      </g>
      <g className={glow ? 'seg-glow-dot' : undefined}>
        <circle cx="110" cy="170" r="8" className="fill-brand-learn" />
      </g>
    </svg>
  );
}
