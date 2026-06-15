import { Link } from 'react-router';
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
  Separator,
  Skeleton,
} from '@databricks/appkit-ui/react';
import { Activity, ArrowRight, Database, HeartPulse, MapPin } from 'lucide-react';

interface FacilitySummary {
  totalFacilities: number;
  countries: number;
  cities: number;
  organizationTypes: number;
  latestSnapshotAt: string | null;
  snapshotMode: string;
  sourceTable: string;
  snapshotRowCount: number;
}

const statCards = [
  {
    key: 'totalFacilities',
    label: 'Facilities',
    icon: HeartPulse,
  },
  {
    key: 'countries',
    label: 'Countries',
    icon: MapPin,
  },
  {
    key: 'cities',
    label: 'Cities',
    icon: Activity,
  },
  {
    key: 'organizationTypes',
    label: 'Organization types',
    icon: Database,
  },
] as const;

function formatCount(value: number) {
  return new Intl.NumberFormat('en-US', { notation: 'compact' }).format(value);
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return 'Not loaded yet';
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function HomePage() {
  const [summary, setSummary] = useState<FacilitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadSummary() {
      setLoading(true);
      try {
        const response = await fetch('/api/facilities/summary');
        const payload = (await response.json()) as FacilitySummary | { error?: string; guidance?: string };

        if (!response.ok) {
          const problem = payload as { error?: string };
          throw new Error(problem.error || 'Failed to load facility summary.');
        }

        if (active) {
          setSummary(payload as FacilitySummary);
          setError(null);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load facility summary.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadSummary();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-[2rem] border border-border/60 bg-card/90 p-8 shadow-[0_30px_80px_-40px_rgba(11,32,38,0.45)] md:p-12">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,54,33,0.16),transparent_28%),radial-gradient(circle_at_left,rgba(11,32,38,0.1),transparent_24%)]" />
        <div className="relative grid gap-8 lg:grid-cols-[1.4fr_0.9fr] lg:items-end">
          <div className="space-y-5">
            <Badge variant="outline" className="bg-background/80 text-foreground">
              DAIS Healthcare Access Demo
            </Badge>
            <div className="space-y-3">
              <h2 className="max-w-3xl text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
                A polished facilities explorer on Lakebase, built for fast hackathon demos.
              </h2>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
                This demo app reads a curated snapshot of the DAIS 2026 Marketplace dataset from Lakebase,
                giving us low-latency browsing while keeping the data path simple enough to ship quickly.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/explorer"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5"
              >
                Open the explorer
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="https://developers.databricks.com/templates/hackathon-app-with-synced-dataset"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-background/80 px-5 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
              >
                Recipe source
              </a>
            </div>
          </div>

          <Card className="border-border/60 bg-background/90 shadow-none">
            <CardHeader className="space-y-3">
              <Badge variant="secondary" className="w-fit">
                Snapshot mode
              </Badge>
              <CardTitle className="text-xl">What this demo is optimized for</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <p>
                We intentionally skipped true continuous sync because the Marketplace source table does not
                currently satisfy the synced-table prerequisites. This build focuses on a fast, reliable demo
                path instead.
              </p>
              <Separator />
              <div className="space-y-2">
                <p className="font-medium text-foreground">Current data path</p>
                <p>Unity Catalog Marketplace table to one-time snapshot loader to Lakebase explorer UI</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Summary unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {loading &&
          statCards.map((card) => (
            <Card key={card.key} className="border-border/60">
              <CardHeader className="space-y-3">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-10 w-28" />
              </CardHeader>
            </Card>
          ))}

        {!loading &&
          summary &&
          statCards.map((card) => {
            const Icon = card.icon;
            const value = summary[card.key];

            return (
              <Card key={card.key} className="border-border/60 bg-card/90 shadow-none">
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
                  <span className="rounded-full bg-secondary p-2 text-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-semibold tracking-tight text-foreground">{formatCount(value)}</p>
                </CardContent>
              </Card>
            );
          })}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-border/60 bg-card/90 shadow-none">
          <CardHeader>
            <CardTitle>Snapshot status</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-muted-foreground">Latest import</p>
              <p className="font-medium text-foreground">
                {loading ? 'Loading...' : formatTimestamp(summary?.latestSnapshotAt ?? null)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground">Imported rows</p>
              <p className="font-medium text-foreground">
                {loading ? 'Loading...' : formatCount(summary?.snapshotRowCount ?? 0)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground">Mode</p>
              <p className="font-medium uppercase tracking-[0.18em] text-foreground">
                {loading ? 'Loading...' : (summary?.snapshotMode ?? 'demo_snapshot').replace('_', ' ')}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground">Source table</p>
              <p className="break-all font-medium text-foreground">{loading ? 'Loading...' : summary?.sourceTable}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/90 shadow-none">
          <CardHeader>
            <CardTitle>Explorer highlights</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div className="rounded-2xl bg-secondary/70 p-4">
              <p className="font-medium text-foreground">Searchable facility directory</p>
              <p className="mt-1">Search by provider name, specialty, city, or organization type with low-latency reads from Lakebase.</p>
            </div>
            <div className="rounded-2xl bg-secondary/70 p-4">
              <p className="font-medium text-foreground">Geographic browsing</p>
              <p className="mt-1">Filter across countries and high-signal cities to quickly narrow the healthcare access landscape.</p>
            </div>
            <div className="rounded-2xl bg-secondary/70 p-4">
              <p className="font-medium text-foreground">Honest demo framing</p>
              <p className="mt-1">The UI clearly communicates that this is a snapshot-backed demo, not a true continuous sync yet.</p>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
