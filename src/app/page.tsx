/**
 * 7-Segment Display Logic Simulator — application shell.
 *
 * Dashboard layout: display + input controls on the left, analytical panels
 * (truth table, K-map, expressions, circuit, characters, projects) in tabs on
 * the right. Everything is driven by the single Zustand store (truth table).
 */
'use client';

import { useEffect, useRef } from 'react';
import { Table2, Grid3x3, Sigma, CircuitBoard, Shapes, FolderOpen, Cpu } from 'lucide-react';
import { useSimulator, attachPersistence } from '@/lib/store';
import { AppHeader } from '@/components/simulator/AppHeader';
import { DisplayCard } from '@/components/simulator/DisplayCard';
import { InputControlsCard } from '@/components/simulator/InputControlsCard';
import { TruthTableCard } from '@/components/simulator/TruthTableCard';
import { KarnaughMapCard } from '@/components/simulator/KarnaughMapCard';
import { BooleanExpressionsCard } from '@/components/simulator/BooleanExpressionsCard';
import { LogicCircuitCard } from '@/components/simulator/LogicCircuitCard';
import { CustomCharacterCard } from '@/components/simulator/CustomCharacterCard';
import { ProjectManagerCard } from '@/components/simulator/ProjectManagerCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function Home() {
  const hydrate = useSimulator((s) => s.hydrate);
  const syncPresets = useSimulator((s) => s.syncPresetsFromServer);
  const inputBits = useSimulator((s) => s.inputBits);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    hydrate();
    void syncPresets();
    return attachPersistence();
  }, [hydrate, syncPresets]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40">
        <AppHeader displaySvgRef={svgRef} />
      </header>

      <main className="flex-1" aria-label="Simulator workspace">
        <div className="mx-auto grid max-w-7xl items-start gap-4 p-4 lg:grid-cols-[minmax(330px,400px)_1fr]">
          {/* left column: live hardware view */}
          <div className="min-w-0 space-y-4">
            <DisplayCard svgRef={svgRef} />
            <InputControlsCard />
          </div>

          {/* right column: analysis panels */}
          <Tabs defaultValue="truth-table" className="w-full min-w-0">
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-muted/60 p-1">
              <TabsTrigger value="truth-table" className="gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Table2 className="h-3.5 w-3.5" aria-hidden /> Truth Table
              </TabsTrigger>
              <TabsTrigger value="kmap" className="gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Grid3x3 className="h-3.5 w-3.5" aria-hidden /> K-Map
              </TabsTrigger>
              <TabsTrigger value="expressions" className="gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Sigma className="h-3.5 w-3.5" aria-hidden /> Expressions
              </TabsTrigger>
              <TabsTrigger value="circuit" className="gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <CircuitBoard className="h-3.5 w-3.5" aria-hidden /> Circuit
              </TabsTrigger>
              <TabsTrigger value="characters" className="gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Shapes className="h-3.5 w-3.5" aria-hidden /> Characters
              </TabsTrigger>
              <TabsTrigger value="projects" className="gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <FolderOpen className="h-3.5 w-3.5" aria-hidden /> Projects
              </TabsTrigger>
            </TabsList>

            <TabsContent value="truth-table" className="mt-3">
              <TruthTableCard />
            </TabsContent>
            <TabsContent value="kmap" className="mt-3">
              <KarnaughMapCard />
            </TabsContent>
            <TabsContent value="expressions" className="mt-3">
              <BooleanExpressionsCard />
            </TabsContent>
            <TabsContent value="circuit" className="mt-3">
              <LogicCircuitCard />
            </TabsContent>
            <TabsContent value="characters" className="mt-3">
              <CustomCharacterCard />
            </TabsContent>
            <TabsContent value="projects" className="mt-3">
              <ProjectManagerCard />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <footer className="mt-auto border-t bg-muted/40 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5" aria-hidden />
            7-Segment Logic Simulator
          </span>
          <span className="hidden sm:inline">
            truth table → Karnaugh maps → Quine-McCluskey minimization → gate-level simulation
          </span>
          <span className="ml-auto font-mono">
            {inputBits}-bit · {1 << inputBits} rows · 8 outputs · everything derived from one data model
          </span>
        </div>
      </footer>
    </div>
  );
}
