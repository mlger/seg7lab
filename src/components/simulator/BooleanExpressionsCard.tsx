/**
 * Boolean expressions: simplified SOP / POS, canonical SOP (Σm) / canonical POS
 * (ΠM), minterm & don't-care listings, reduction statistics, and a custom
 * expression verifier/editor backed by the real parser.
 */
'use client';

import { useMemo, useState } from 'react';
import { Sigma, CheckCircle2, XCircle, Wand2, AlertTriangle } from 'lucide-react';
import { useSimulator } from '@/lib/store';
import { useEngines } from '@/lib/useEngine';
import { ExplainBlock, TermView } from './ExplainBlock';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import {
  SEGMENT_NAMES,
  type ExpressionForm,
  type SegmentName,
  type Term,
} from '@/types/simulator';
import { mintermToTerm, maxtermToTerm } from '@/logic/expressions';
import { parseBoolean, evalBool, astToAscii } from '@/logic/booleanParser';
import { toBits } from '@/utils/binary';

const FORM_LABELS: Record<ExpressionForm, string> = {
  sop: 'Simplified SOP',
  pos: 'Simplified POS',
  csop: 'Canonical SOP (Σ of minterms)',
  cpos: 'Canonical POS (Π of maxterms)',
};

function ExpressionRow({ terms, form }: { terms: Term[]; form: ExpressionForm }) {
  if (terms.length === 0) {
    return <span className="font-mono">{form === 'sop' || form === 'csop' ? '0' : '1'}</span>;
  }
  if (form === 'sop' || form === 'csop') {
    return (
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {terms.map((t, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted-foreground">+</span>}
            {t.literals.length > 1 ? (
              <TermView literals={t.literals} op="·" />
            ) : (
              <TermView literals={t.literals} op="·" />
            )}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {terms.map((t, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-muted-foreground">·</span>}
          {t.literals.length > 1 && <span>(</span>}
          <TermView literals={t.literals} op="+" />
          {t.literals.length > 1 && <span>)</span>}
        </span>
      ))}
    </span>
  );
}

function CustomExpressionEditor({ segment, numVars }: { segment: SegmentName; numVars: number }) {
  const table = useSimulator((s) => s.truthTable);
  const setRowPattern = useSimulator((s) => s.setRowPattern);
  const [text, setText] = useState('');
  const [result, setResult] = useState<
    | { kind: 'idle' }
    | { kind: 'error'; message: string }
    | { kind: 'match'; astText: string }
    | { kind: 'mismatch'; astText: string; mismatches: number[] }
  >({ kind: 'idle' });

  const varNames = useSimulator((s) => s.variableNames);

  const verify = () => {
    const parsed = parseBoolean(text, varNames);
    if (!parsed.ok) {
      setResult({ kind: 'error', message: `E-220: ${parsed.error.message} (position ${parsed.error.position + 1})` });
      return;
    }
    const mismatches: number[] = [];
    for (const row of table.rows) {
      const expected = row.outputs[segment];
      if (expected === 'X') continue;
      const bits = toBits(row.input, numVars);
      const env: Record<string, 0 | 1> = {};
      varNames.forEach((v, i) => { env[v] = bits[i]; });
      const got = evalBool(parsed.ast, env);
      if (got !== expected) mismatches.push(row.input);
    }
    setResult(
      mismatches.length === 0
        ? { kind: 'match', astText: astToAscii(parsed.ast) }
        : { kind: 'mismatch', astText: astToAscii(parsed.ast), mismatches },
    );
  };

  const apply = () => {
    const parsed = parseBoolean(text, varNames);
    if (!parsed.ok) return;
    for (const row of table.rows) {
      // don't-care cells stay X; defined cells take the expression's value
      if (row.outputs[segment] === 'X') continue;
      const bits = toBits(row.input, numVars);
      const env: Record<string, 0 | 1> = {};
      varNames.forEach((v, i) => { env[v] = bits[i]; });
      const v = evalBool(parsed.ast, env);
      setRowPattern(row.input, { ...row.outputs, [segment]: v });
    }
    setResult({ kind: 'match', astText: astToAscii(parsed.ast) });
  };

  return (
    <div className="mt-2 space-y-2 rounded-md border bg-muted/20 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 flex-1 font-mono text-xs min-w-[180px]"
          placeholder={`e.g. ${varNames.join('+')} or !${varNames[0]}·${varNames[1]}`}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult({ kind: 'idle' });
          }}
          aria-label={`Custom Boolean expression for segment ${segment}`}
        />
        <Button size="sm" variant="outline" className="h-8" onClick={verify} disabled={!text.trim()}>
          <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Verify
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="h-8"
          onClick={apply}
          disabled={!text.trim() || result.kind === 'error'}
        >
          <Wand2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Apply to table
        </Button>
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground">
        Syntax: variables {varNames.join(' ')}; operators + (OR), · / * / juxtaposition (AND), ^ (XOR),
        ! ~ ¬ or trailing &apos; (NOT), parentheses, constants 0/1. Verify compares against the truth
        table on all defined cells; Apply rewrites defined cells (don&apos;t-cares are kept).
      </p>
      {result.kind === 'error' && (
        <p className="flex items-start gap-1.5 text-xs text-destructive" role="alert">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {result.message}
        </p>
      )}
      {result.kind === 'match' && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Matches the truth table on all defined inputs. Parsed as:{' '}
          <span className="font-mono">{result.astText}</span>
        </p>
      )}
      {result.kind === 'mismatch' && (
        <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400" role="status">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          E-221: Expression differs from the truth table at minterm
          {result.mismatches.length > 1 ? 's' : ''}{' '}
          <span className="font-mono">{result.mismatches.map((m) => `m${m}`).join(', ')}</span>.
        </p>
      )}
    </div>
  );
}

export function BooleanExpressionsCard() {
  const expressionForm = useSimulator((s) => s.expressionForm);
  const setExpressionForm = useSimulator((s) => s.setExpressionForm);
  const activeSegment = useSimulator((s) => s.activeSegment);
  const setActiveSegment = useSimulator((s) => s.setActiveSegment);
  const explain = useSimulator((s) => s.explainMode);
  const truthTable = useSimulator((s) => s.truthTable);
  const engines = useEngines();
  const numVars = truthTable.inputBits;

  const forms: ExpressionForm[] = ['sop', 'pos', 'csop', 'cpos'];

  const canonical = useMemo(() => {
    const out = {} as Record<SegmentName, { sop: Term[]; pos: Term[] }>;
    for (const seg of SEGMENT_NAMES) {
      out[seg] = {
        sop: engines[seg].ones.map((m) => mintermToTerm(m, numVars)),
        pos: engines[seg].zeros.map((m) => maxtermToTerm(m, numVars)),
      };
    }
    return out;
  }, [engines, numVars]);

  return (
    <Card id="expressions-card">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide">
            <Sigma className="h-4 w-4 text-muted-foreground" aria-hidden />
            BOOLEAN EXPRESSIONS
          </CardTitle>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Expression form selector">
            {forms.map((f) => (
              <Button
                key={f}
                size="sm"
                variant={expressionForm === f ? 'default' : 'ghost'}
                className="h-7 px-2.5 text-xs"
                onClick={() => setExpressionForm(f)}
                aria-pressed={expressionForm === f}
              >
                {FORM_LABELS[f]}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Accordion
          type="single"
          collapsible
          value={activeSegment}
          onValueChange={(v) => v && setActiveSegment(v as SegmentName)}
        >
          {SEGMENT_NAMES.map((seg) => {
            const e = engines[seg];
            const terms =
              expressionForm === 'sop' ? e.activeSopTerms
              : expressionForm === 'pos' ? e.activePosTerms
              : expressionForm === 'csop' ? canonical[seg].sop
              : canonical[seg].pos;
            const stats =
              expressionForm === 'sop' ? e.stats.simplifiedSop
              : expressionForm === 'pos' ? e.stats.simplifiedPos
              : expressionForm === 'csop' ? e.stats.canonicalSop
              : e.stats.canonicalPos;
            const isCanonical = expressionForm === 'csop' || expressionForm === 'cpos';
            const canonicalStats = expressionForm === 'csop' || expressionForm === 'sop'
              ? e.stats.canonicalSop : e.stats.canonicalPos;
            const reduction = canonicalStats.literals > 0 && !isCanonical
              ? Math.round((1 - stats.literals / canonicalStats.literals) * 100)
              : 0;
            return (
              <AccordionItem key={seg} value={seg} className="border-b-0">
                <AccordionTrigger className="py-2 hover:no-underline">
                  <span className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <Badge variant="outline" className="font-mono">{seg}</Badge>
                    <span className="flex min-w-0 flex-1 flex-wrap items-center font-mono text-[13px]">
                      <span className="mr-1.5 text-muted-foreground">=</span>
                      <ExpressionRow terms={terms} form={expressionForm} />
                    </span>
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {stats.terms}T · {stats.literals}L
                    </Badge>
                    {!isCanonical && reduction > 0 && (
                      <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 font-mono text-[10px]">
                        −{reduction}% literals
                      </Badge>
                    )}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-2 pb-3">
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      Σm ={' '}
                      <span className="font-mono text-foreground/80">
                        ({e.ones.join(', ') || '—'})
                      </span>
                    </span>
                    <span>
                      ΠM ={' '}
                      <span className="font-mono text-foreground/80">
                        ({e.zeros.join(', ') || '—'})
                      </span>
                    </span>
                    <span>
                      d ={' '}
                      <span className="font-mono text-foreground/80">
                        ({e.dontCares.join(', ') || '—'})
                      </span>
                    </span>
                  </div>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {isCanonical
                      ? expressionForm === 'csop'
                        ? 'Canonical SOP: one full minterm (all variables) per row where the output is 1.'
                        : 'Canonical POS: one full maxterm per row where the output is 0.'
                      : `Minimized with Quine-McCluskey over the minterms and don't-cares — ${e.sop.primes.length} prime implicant(s) found; canonical form would need ${canonicalStats.terms} terms / ${canonicalStats.literals} literals.`}
                  </p>
                  <CustomExpressionEditor segment={seg} numVars={numVars} />
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>

        {explain && (
          <ExplainBlock title="From truth table to Boolean algebra">
            <p>
              Two standard forms describe any combinational function exactly:
            </p>
            <p>
              <strong>Canonical SOP</strong> — the sum (OR) of minterms: one product term per row where
              the output is 1. For segment {activeSegment} that is{' '}
              <span className="font-mono">Σm({engines[activeSegment].ones.join(', ') || '—'})</span>.
            </p>
            <p>
              <strong>Canonical POS</strong> — the product (AND) of maxterms: one sum term per row where
              the output is 0: <span className="font-mono">ΠM({engines[activeSegment].zeros.join(', ') || '—'})</span>.
            </p>
            <p>
              The simplified forms apply Boolean minimization (Quine-McCluskey with don&apos;t-care
              exploitation) to reduce literal count while preserving the function on every defined
              input. For segment {activeSegment}, the simplified SOP needs{' '}
              {engines[activeSegment].stats.simplifiedSop.terms} terms with{' '}
              {engines[activeSegment].stats.simplifiedSop.literals} literals versus{' '}
              {engines[activeSegment].stats.canonicalSop.literals} literals canonically
              {engines[activeSegment].stats.canonicalSop.literals > 0 && (
                <>
                  {' '}({Math.round((1 - engines[activeSegment].stats.simplifiedSop.literals / engines[activeSegment].stats.canonicalSop.literals) * 100)}% fewer)
                </>
              )}.
            </p>
            <p>
              POS forms are obtained by minimizing the complement (0s instead of 1s) and applying
              De Morgan&apos;s theorem — each K-map group of 0s becomes a sum term.
            </p>
            <p>
              Type a custom expression for any segment to verify it against the truth table, or apply
              it to regenerate rows — the parser supports AND, OR, NOT and XOR.
            </p>
          </ExplainBlock>
        )}
      </CardContent>
    </Card>
  );
}
