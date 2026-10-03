/**
 * Route-level error boundary (client). Catches render/runtime errors from
 * the simulator page, shows a readable message plus the Next.js digest, and
 * offers a soft recovery (retry the route segment) and a hard reload.
 */
'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[simulator] route error:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2.5 text-base font-semibold tracking-wide">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" aria-hidden />
            </span>
            Simulator error
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Something went wrong while rendering the simulator. Your saved projects and
            presets are safe — nothing is lost. Try again, or reload the page for a
            clean state.
          </p>
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="break-words font-mono text-xs leading-snug text-foreground/80">
              {error.message || 'Unknown error'}
            </p>
            {error.digest && (
              <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                digest: {error.digest}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => reset()}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Try again
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Reload page
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
