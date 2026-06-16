import { useEffect, useState } from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
} from '@databricks/appkit-ui/react';
import { BrainCircuit, FileCode2, Settings2 } from 'lucide-react';

interface PipelineStage {
  id: string;
  title: string;
  file: string;
  functions: string[];
  description: string;
}

interface PipelineBlueprint {
  name: string;
  summary: string;
  pythonRoot: string;
  configPath: string;
  requirementsPath: string;
  stages: PipelineStage[];
  databricksTables: string[];
  configPreview: {
    topNTreatments: number;
    openAiModel: string;
    distanceDecay: string;
    outputFile: string;
  };
}

export function PrioritizationPage() {
  const [blueprint, setBlueprint] = useState<PipelineBlueprint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadBlueprint() {
      setLoading(true);
      try {
        const response = await fetch('/api/prioritization/blueprint');
        const payload = (await response.json()) as PipelineBlueprint | { error?: string };

        if (!response.ok) {
          const problem = payload as { error?: string };
          throw new Error(problem.error || 'Failed to load prioritization blueprint.');
        }

        if (active) {
          setBlueprint(payload as PipelineBlueprint);
          setError(null);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load prioritization blueprint.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadBlueprint();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1.3fr_0.9fr]">
        <Card className="border-border/60 bg-card/90 shadow-none">
          <CardContent className="p-8">
            <div className="space-y-4">
              <Badge variant="outline">Integrated legacy pipeline</Badge>
              <div className="space-y-3">
                <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                  Your original prioritization workflow now lives inside the templated app.
                </h2>
                <p className="max-w-3xl text-base leading-7 text-muted-foreground">
                  The Python package, config, and stage boundaries from the earlier repo structure are now embedded
                  in this AppKit project so we can build the UI and deployment story around the same pipeline shape.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/90 shadow-none">
          <CardHeader>
            <CardTitle className="text-base">What was integrated</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div>
              <p className="font-medium text-foreground">Python source root</p>
              <p className="break-all">{loading ? 'Loading...' : blueprint?.pythonRoot}</p>
            </div>
            <div>
              <p className="font-medium text-foreground">Pipeline config</p>
              <p className="break-all">{loading ? 'Loading...' : blueprint?.configPath}</p>
            </div>
            <div>
              <p className="font-medium text-foreground">Python dependencies</p>
              <p className="break-all">{loading ? 'Loading...' : blueprint?.requirementsPath}</p>
            </div>
          </CardContent>
        </Card>
      </section>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Prioritization blueprint unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {loading &&
          Array.from({ length: 4 }, (_, index) => (
            <Card key={index} className="border-border/60">
              <CardHeader className="space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-20" />
              </CardHeader>
            </Card>
          ))}

        {!loading &&
          blueprint &&
          [
            { label: 'Pipeline stages', value: blueprint.stages.length, icon: BrainCircuit },
            { label: 'Configured UC tables', value: blueprint.databricksTables.length, icon: Settings2 },
            { label: 'Top N treatments', value: blueprint.configPreview.topNTreatments, icon: FileCode2 },
            { label: 'Output artifact', value: blueprint.configPreview.outputFile, icon: FileCode2 },
          ].map((stat) => {
            const Icon = stat.icon;

            return (
              <Card key={stat.label} className="border-border/60 bg-card/90 shadow-none">
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
                  <span className="rounded-full bg-secondary p-2 text-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-semibold tracking-tight text-foreground">{String(stat.value)}</p>
                </CardContent>
              </Card>
            );
          })}
      </section>

      {loading && (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Card key={index} className="border-border/60">
              <CardHeader className="space-y-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-full" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!loading && blueprint && blueprint.stages.length === 0 && (
        <Empty className="rounded-3xl border border-dashed border-border/80 py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BrainCircuit className="h-5 w-5" />
            </EmptyMedia>
            <EmptyTitle>No pipeline stages found</EmptyTitle>
            <EmptyDescription>
              The app is ready to surface the prioritization workflow once the module list is populated.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {!loading && blueprint && blueprint.stages.length > 0 && (
        <section className="grid gap-4 lg:grid-cols-2">
          {blueprint.stages.map((stage) => (
            <Card key={stage.id} className="border-border/60 bg-card/90 shadow-none">
              <CardHeader className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{stage.title}</Badge>
                  <Badge variant="outline">{stage.functions.length} functions</Badge>
                </div>
                <CardTitle className="text-xl">{stage.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <p className="leading-6 text-muted-foreground">{stage.description}</p>
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">File</p>
                  <p className="break-all font-medium text-foreground">{stage.file}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Functions</p>
                  <div className="flex flex-wrap gap-2">
                    {stage.functions.map((fn) => (
                      <Badge key={fn} variant="outline">
                        {fn}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
