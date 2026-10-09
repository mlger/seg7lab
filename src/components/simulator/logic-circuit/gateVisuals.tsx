/**
 * Gate visuals shared by the circuit canvas (live drawing) and the gate
 * reference panel (static symbols): the SVG symbol builder and the
 * plain-language gate descriptions.
 */
'use client';

import type { GateType } from '@/logic/circuitNetlist';

export const GATE_INFO: Record<string, { desc: string; expr: string; part: string }> = {
  AND: {
    desc: 'Outputs 1 only when every input is 1.',
    expr: 'Y = A·B',
    part: '74HC08 (quad 2-in) · 74HC11 (triple 3-in)',
  },
  OR: {
    desc: 'Outputs 1 when at least one input is 1.',
    expr: 'Y = A + B',
    part: '74HC32 (quad 2-in) · 74HC4075 (triple 3-in)',
  },
  NOT: {
    desc: 'Inverts its single input.',
    expr: "Y = A'",
    part: '74HC04 (hex inverter)',
  },
  NAND: {
    desc: 'AND followed by inversion — outputs 0 only when every input is 1.',
    expr: "Y = (A·B)'",
    part: '74HC00 (quad 2-in) · 74HC10 (triple 3-in)',
  },
  NOR: {
    desc: 'OR followed by inversion — outputs 1 only when every input is 0.',
    expr: "Y = (A+B)'",
    part: '74HC02 (quad 2-in) · 74HC27 (triple 3-in)',
  },
  XOR: {
    desc: 'Outputs 1 when an odd number of inputs are 1.',
    expr: 'Y = A ⊕ B',
    part: '74HC86 (quad 2-in)',
  },
  XNOR: {
    desc: 'XOR followed by inversion — outputs 1 when inputs are equal.',
    expr: "Y = (A ⊕ B)'",
    part: '74HC7266 (quad 2-in)',
  },
};

/** SVG body of one gate symbol (no wrapper <g> — caller positions it).
 *  Textbook-schematic treatment, matching the reference figure: a monoline
 *  outline with a pale blue body. The only colour change is that an ACTIVE
 *  gate (output currently logic 1) takes the accent stroke/body — so the
 *  schematic still shows the live signal path without looking like a dashboard.
 */
export function gateSymbol(type: GateType, x: number, y: number, w: number, h: number, active: boolean) {
  const stroke = active ? '#0f766e' : 'rgba(30,30,36,0.85)';
  const fill = active ? 'rgba(15,118,110,0.14)' : 'rgba(173,196,222,0.20)';
  const bubble = (bx: number) => (
    <circle cx={bx} cy={y + h / 2} r={6} fill="none" stroke={stroke} strokeWidth={1.8} />
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
