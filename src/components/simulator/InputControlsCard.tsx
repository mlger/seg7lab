/**
 * Input controls: bit toggle switches, binary / decimal / hex text entry with
 * validation, and increment / decrement steering.
 */
'use client';

import { useState } from 'react';
import { ArrowDownToLine, ArrowUpToLine } from 'lucide-react';
import { useSimulator } from '@/lib/store';
import { useCurrentInput } from '@/lib/useEngine';
import { parseBinary, parseDecimal, parseHex } from '@/utils/binary';
import { ExplainBlock } from './ExplainBlock';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

function ValidatedInput({
  label,
  value,
  placeholder,
  parse,
  mono = true,
  ariaLabel,
}: {
  label: string;
  value: number;
  placeholder: string;
  parse: (text: string, bits: number) => { ok: boolean; value?: number; error?: string };
  mono?: boolean;
  ariaLabel: string;
}) {
  const setInput = useSimulator((s) => s.setInput);
  const bits = useSimulator((s) => s.inputBits);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const placeholderFor = (v: number): string => {
    return label === 'Binary' ? v.toString(2).padStart(bits, '0')
      : label === 'Hex' ? v.toString(16).toUpperCase()
      : String(v);
  };

  // Sync text state with the store while the field is not focused
  // ("adjust state during render" pattern — no setState-in-effect).
  const syncKey = `${value}|${bits}|${focused}`;
  const [lastSyncKey, setLastSyncKey] = useState(syncKey);
  const [text, setText] = useState(() => placeholderFor(value));
  if (syncKey !== lastSyncKey) {
    setLastSyncKey(syncKey);
    if (!focused) setText(placeholderFor(value));
  }

  const commit = () => {
    const result = parse(text, bits);
    if (result.ok && result.value !== undefined) {
      setInput(result.value);
      setError(null);
    } else {
      setError(result.error ?? 'Invalid value');
    }
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`in-${label.toLowerCase()}`} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={`in-${label.toLowerCase()}`}
        aria-label={ariaLabel}
        aria-invalid={!!error}
        className={cn('h-9 font-mono', mono && 'tracking-wider', error && 'border-destructive')}
        value={text}
        placeholder={placeholderFor(value)}
        inputMode={label === 'Binary' ? 'numeric' : 'text'}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {error && (
        <p className="text-[11px] leading-snug text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function InputControlsCard() {
  const current = useCurrentInput();
  const explain = useSimulator((s) => s.explainMode);
  const toggleBit = useSimulator((s) => s.toggleBit);
  const incrementInput = useSimulator((s) => s.incrementInput);
  const decrementInput = useSimulator((s) => s.decrementInput);
  const varNames = current.bits === 5 ? ['E', 'D', 'C', 'B', 'A'] : ['D', 'C', 'B', 'A'];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold tracking-wide">INPUT CONTROLS</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* bit toggles */}
        <div
          className="flex flex-wrap justify-center gap-3 sm:gap-4"
          role="group"
          aria-label="Input bit toggles, most significant bit first"
        >
          {current.bitValues.map((bit, msbIndex) => (
            <div key={msbIndex} className="flex min-w-[3.2rem] flex-col items-center gap-1.5">
              <Label
                htmlFor={`bit-${msbIndex}`}
                className="font-mono text-xs font-semibold text-muted-foreground"
              >
                {varNames[msbIndex]}
              </Label>
              <button
                type="button"
                id={`bit-${msbIndex}`}
                role="switch"
                aria-checked={bit === 1}
                aria-label={`Bit ${varNames[msbIndex]} (weight ${1 << (current.bits - 1 - msbIndex)}), currently ${bit}`}
                onClick={() => toggleBit(msbIndex)}
                className={cn(
                  'flex h-11 w-11 items-center justify-center rounded-lg border-2 font-mono text-base font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  bit === 1
                    ? 'border-emerald-500/70 bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.25)]'
                    : 'border-border bg-muted/50 text-muted-foreground hover:border-muted-foreground/40',
                )}
              >
                {bit}
              </button>
            </div>
          ))}
        </div>

        {/* text inputs */}
        <div className="grid grid-cols-3 gap-3">
          <ValidatedInput
            label="Binary"
            value={current.input}
            placeholder={current.binary}
            parse={parseBinary}
            ariaLabel={`Binary input, ${current.bits} bits`}
          />
          <ValidatedInput
            label="Decimal"
            value={current.input}
            placeholder={String(current.decimal)}
            parse={parseDecimal}
            ariaLabel="Decimal input"
          />
          <ValidatedInput
            label="Hex"
            value={current.input}
            placeholder={current.hex}
            parse={parseHex}
            ariaLabel="Hexadecimal input"
          />
        </div>

        {/* steering */}
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={decrementInput}
            aria-label="Decrement input value (wraps around)"
            className="min-w-[2.75rem]"
          >
            <ArrowDownToLine className="h-4 w-4" aria-hidden />
          </Button>
          <div className="flex items-center gap-2 font-mono text-sm">
            <span className="text-muted-foreground">value</span>
            <span className="rounded-md bg-muted/60 px-3 py-1 font-semibold tabular-nums">
              {current.decimal}
            </span>
            <span className="text-muted-foreground">/ {(1 << current.bits) - 1}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={incrementInput}
            aria-label="Increment input value (wraps around)"
            className="min-w-[2.75rem]"
          >
            <ArrowUpToLine className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        {explain && (
          <ExplainBlock title="How the input drives everything">
            <p>
              The {current.bits}-bit input is a binary number where{' '}
              {varNames.map((v, i) => `${v} (weight ${1 << (current.bits - 1 - i)})`).join(', ')}.
              Changing it immediately updates the 7-segment display, highlights truth-table row{' '}
              <span className="font-mono">m{current.input}</span>, and re-evaluates the K-maps,
              expressions and logic circuit — all derived from the same table.
            </p>
            <p>
              Current combination <span className="font-mono">{current.binary}</span> ={' '}
              {current.decimal}₁₀ = 0x{current.hex} = minterm m{current.input}.
            </p>
          </ExplainBlock>
        )}
      </CardContent>
    </Card>
  );
}
