/**
 * Gate visuals shared by the circuit canvas (live drawing) and the gate
 * reference panel (static symbols): the SVG symbol builder and the
 * plain-language gate descriptions.
 */
'use client';

import type { GateType } from '@/logic/circuitNetlist';

export const GATE_INFO: Record<string, { desc: string; expr: string }> = {
  AND: { desc: 'Outputs 1 only when every input is 1.', expr: 'Y = A·B' },
  OR: { desc: 'Outputs 1 when at least one input is 1.', expr: 'Y = A + B' },
  NOT: { desc: 'Inverts its single input.', expr: "Y = A'" },
  NAND: { desc: 'AND followed by inversion — outputs 0 only when every input is 1.', expr: "Y = (A·B)'" },
  NOR: { desc: 'OR followed by inversion — outputs 1 only when every input is 0.', expr: "Y = (A+B)'" },
  XOR: { desc: 'Outputs 1 when an odd number of inputs are 1.', expr: 'Y = A ⊕ B' },
  XNOR: { desc: 'XOR followed by inversion — outputs 1 when inputs are equal.', expr: "Y = (A ⊕ B)'" },
};

/** SVG body of one gate symbol (no wrapper <g> — caller positions it). */
export function gateSymbol(type: GateType, x: number, y: number, w: number, h: number, active: boolean) {
  const stroke = active ? '#10b981' : 'currentColor';
  const fill = active ? 'rgba(16,185,129,0.12)' : 'rgba(128,128,128,0.07)';
  const bubble = (bx: number) => (
    <circle cx={bx} cy={y + h / 2} r={6} fill="none" stroke={stroke} strokeWidth={2} />
  );
  switch (type) {
    case 'and':
    case 'nand': {
      const bodyW = type === 'nand' ? w - 12 : w;
      return (
        <>
          <path
            d={`M ${x},${y} L ${x + bodyW * 0.52},${y} A ${h / 2},${h / 2} 0 0 1 ${x + bodyW * 0.52},${y + h} L ${x},${y + h} Z`}
            fill={fill} stroke={stroke} strokeWidth={2}
          />
          {type === 'nand' && bubble(x + w - 6)}
        </>
      );
    }
    case 'or':
    case 'nor': {
      const bodyW = type === 'nor' ? w - 12 : w;
      const mx = x + bodyW;
      return (
        <>
          <path
            d={`M ${x},${y} Q ${x + bodyW * 0.55},${y} ${mx},${y + h / 2} Q ${x + bodyW * 0.55},${y + h} ${x},${y + h} Q ${x + bodyW * 0.34},${y + h / 2} ${x},${y} Z`}
            fill={fill} stroke={stroke} strokeWidth={2}
          />
          {type === 'nor' && bubble(x + w - 6)}
        </>
      );
    }
    case 'xor':
    case 'xnor': {
      const bodyW = type === 'xnor' ? w - 12 : w;
      const mx = x + bodyW;
      return (
        <>
          <path
            d={`M ${x + 8},${y} Q ${x + bodyW * 0.55},${y} ${mx},${y + h / 2} Q ${x + bodyW * 0.55},${y + h} ${x + 8},${y + h} Q ${x + bodyW * 0.34},${y + h / 2} ${x + 8},${y} Z`}
            fill={fill} stroke={stroke} strokeWidth={2}
          />
          <path
            d={`M ${x},${y} Q ${x + bodyW * 0.34},${y + h / 2} ${x},${y + h}`}
            fill="none" stroke={stroke} strokeWidth={2}
          />
          {type === 'xnor' && bubble(x + w - 6)}
        </>
      );
    }
    case 'not': {
      const tw = w - 16;
      return (
        <>
          <path
            d={`M ${x},${y} L ${x + tw},${y + h / 2} L ${x},${y + h} Z`}
            fill={fill} stroke={stroke} strokeWidth={2}
          />
          {bubble(x + w - 6)}
        </>
      );
    }
    default:
      return null;
  }
}
