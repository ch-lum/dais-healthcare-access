import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@databricks/appkit-ui/react';
import {
  ArrowRight,
  Bus,
  Clock3,
  Gauge,
  HeartPulse,
  Map,
  MapPinned,
  RefreshCw,
  Route,
  Sparkles,
  Users,
} from 'lucide-react';

interface RecommendationSummary {
  totalRecommendations: number;
  treatments: number;
  estimatedPeopleAffected: number;
  averageBurdenReductionPct: number;
  latestUpdatedAt: string | null;
  topRecommendation: {
    treatment?: string;
    origin_region?: string;
    origin_state?: string;
    destination_facility_name?: string;
    priority_score?: number | string;
  } | null;
}

interface TreatmentOption {
  value: string;
  count: number;
  averagePriorityScore: number;
  estimatedPeopleAffected: number;
}

interface TreatmentOptionsResponse {
  treatments: TreatmentOption[];
}

interface SignalContribution {
  signal: string;
  weight: number;
}

interface ShuttleRecommendation {
  id: string;
  treatment: string;
  origin_region: string;
  origin_state: string | null;
  origin_latitude: number | string | null;
  origin_longitude: number | string | null;
  destination_facility_id: string | null;
  destination_facility_name: string;
  destination_city: string | null;
  destination_state: string | null;
  destination_country: string | null;
  destination_latitude: number | string | null;
  destination_longitude: number | string | null;
  demand_score: number | string;
  estimated_people_affected: number | string;
  current_distance_km: number | string;
  recommended_distance_km: number | string;
  distance_saved_km: number | string;
  transportation_burden_reduction_pct: number | string;
  priority_score: number | string;
  why_region: string;
  why_facility: string;
  top_contributing_signals: string | SignalContribution[];
  snapshot_mode: string;
  source_pipeline_version: string;
  updated_at: string;
}

interface RecommendationsResponse {
  treatment: string;
  recommendations: ShuttleRecommendation[];
}

interface RefreshResponse {
  loadedRows: number;
  updatedAt: string;
}

function toNumber(value: number | string | null | undefined) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function formatNumber(value: number | string | null | undefined) {
  return new Intl.NumberFormat('en-US', { notation: 'compact' }).format(toNumber(value));
}

function formatScore(value: number | string | null | undefined) {
  return toNumber(value).toFixed(1);
}

function formatDistance(value: number | string | null | undefined) {
  return `${Math.round(toNumber(value)).toLocaleString()} km`;
}

function formatPercent(value: number | string | null | undefined) {
  return `${formatScore(value)}%`;
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

function formatLocation(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(', ') || 'Location unavailable';
}

function parseSignals(value: ShuttleRecommendation['top_contributing_signals']) {
  if (Array.isArray(value)) {
    return value;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as SignalContribution[]) : [];
  } catch {
    return [];
  }
}

function hasRouteCoordinates(recommendation: ShuttleRecommendation) {
  const values = [
    recommendation.origin_latitude,
    recommendation.origin_longitude,
    recommendation.destination_latitude,
    recommendation.destination_longitude,
  ];

  if (values.some((value) => value === null || value === undefined || value === '')) {
    return false;
  }

  return (
    Number.isFinite(toNumber(recommendation.origin_latitude)) &&
    Number.isFinite(toNumber(recommendation.origin_longitude)) &&
    Number.isFinite(toNumber(recommendation.destination_latitude)) &&
    Number.isFinite(toNumber(recommendation.destination_longitude))
  );
}

function mapCoordinateBounds(recommendations: ShuttleRecommendation[]) {
  const coordinates = recommendations
    .filter(hasRouteCoordinates)
    .flatMap((recommendation) => [
      {
        lat: toNumber(recommendation.origin_latitude),
        lon: toNumber(recommendation.origin_longitude),
      },
      {
        lat: toNumber(recommendation.destination_latitude),
        lon: toNumber(recommendation.destination_longitude),
      },
    ]);

  if (coordinates.length === 0) {
    return { minLat: 6, maxLat: 38, minLon: 68, maxLon: 98 };
  }

  const lats = coordinates.map((coordinate) => coordinate.lat);
  const lons = coordinates.map((coordinate) => coordinate.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latPad = Math.max((maxLat - minLat) * 0.18, 1.8);
  const lonPad = Math.max((maxLon - minLon) * 0.18, 1.8);

  return {
    minLat: Math.max(5, minLat - latPad),
    maxLat: Math.min(39, maxLat + latPad),
    minLon: Math.max(66, minLon - lonPad),
    maxLon: Math.min(99, maxLon + lonPad),
  };
}

async function fetchJson<T>(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const payload = (await response.json()) as T | { error?: string; guidance?: string };

  if (!response.ok) {
    const problem = payload as { error?: string; guidance?: string };
    throw new Error(problem.guidance ? `${problem.error} ${problem.guidance}` : problem.error || 'Request failed.');
  }

  return payload as T;
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="border-border/60 bg-card/90 shadow-none">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <span className="rounded-full bg-secondary p-2 text-foreground">
          <Icon className="h-4 w-4" />
        </span>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tracking-tight text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

function RecommendationCard({
  recommendation,
  selected,
  onSelect,
}: {
  recommendation: ShuttleRecommendation;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border bg-card/90 p-4 text-left shadow-none transition-colors hover:border-primary/60 ${
        selected ? 'border-primary ring-2 ring-primary/20' : 'border-border/60'
      }`}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{recommendation.treatment}</Badge>
          <Badge variant="outline">Priority {formatScore(recommendation.priority_score)}</Badge>
        </div>

        <div className="space-y-2">
          <div className="flex items-start gap-2 text-base font-semibold leading-6 text-foreground">
            <span>{recommendation.origin_region}</span>
            <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{recommendation.destination_facility_name}</span>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            {formatLocation([recommendation.origin_state])} to{' '}
            {formatLocation([
              recommendation.destination_city,
              recommendation.destination_state,
              recommendation.destination_country,
            ])}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">People</p>
            <p className="text-lg font-semibold text-foreground">
              {formatNumber(recommendation.estimated_people_affected)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Saved</p>
            <p className="text-lg font-semibold text-foreground">{formatDistance(recommendation.distance_saved_km)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Burden</p>
            <p className="text-lg font-semibold text-foreground">
              {formatPercent(recommendation.transportation_burden_reduction_pct)}
            </p>
          </div>
        </div>
      </div>
    </button>
  );
}

function RouteMapView({
  recommendations,
  selectedRecommendation,
  onSelect,
}: {
  recommendations: ShuttleRecommendation[];
  selectedRecommendation: ShuttleRecommendation | null;
  onSelect: (id: string) => void;
}) {
  const drawableRecommendations = recommendations.filter(hasRouteCoordinates);
  const bounds = mapCoordinateBounds(drawableRecommendations);
  const width = 920;
  const height = 560;
  const padding = 48;

  function project(latValue: number | string | null, lonValue: number | string | null) {
    const lat = toNumber(latValue);
    const lon = toNumber(lonValue);
    const x =
      padding +
      ((lon - bounds.minLon) / Math.max(bounds.maxLon - bounds.minLon, 1)) * (width - padding * 2);
    const y =
      padding +
      ((bounds.maxLat - lat) / Math.max(bounds.maxLat - bounds.minLat, 1)) * (height - padding * 2);

    return { x, y };
  }

  if (drawableRecommendations.length === 0) {
    return (
      <Card className="border-border/60 bg-card/90 shadow-none">
        <CardContent className="p-0">
          <Empty className="min-h-[28rem] justify-center p-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Map className="h-5 w-5" />
              </EmptyMedia>
              <EmptyTitle>Map coordinates unavailable</EmptyTitle>
              <EmptyDescription>
                Regenerate and reload recommendations with origin and destination coordinates to draw routes.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  const selected = selectedRecommendation && hasRouteCoordinates(selectedRecommendation) ? selectedRecommendation : drawableRecommendations[0];
  const selectedOrigin = project(selected.origin_latitude, selected.origin_longitude);
  const selectedDestination = project(selected.destination_latitude, selected.destination_longitude);

  return (
    <Card className="overflow-hidden border-border/60 bg-card/95 shadow-none">
      <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Map className="h-5 w-5 text-primary" />
            Shuttle route map
          </CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            District origins are highlighted and linked to their pipeline-selected destination facilities.
          </p>
        </div>
        <Badge variant="outline">{drawableRecommendations.length} mapped routes</Badge>
      </CardHeader>
      <CardContent>
        <div className="relative overflow-hidden rounded-lg border border-border/60 bg-[#f7fbf8]">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Map of district-to-facility shuttle routes"
            className="h-[30rem] w-full"
          >
            <defs>
              <pattern id="map-grid" width="46" height="46" patternUnits="userSpaceOnUse">
                <path d="M 46 0 L 0 0 0 46" fill="none" stroke="#dbe7df" strokeWidth="1" />
              </pattern>
              <filter id="route-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#0b2026" floodOpacity="0.18" />
              </filter>
            </defs>

            <rect width={width} height={height} fill="#f7fbf8" />
            <rect width={width} height={height} fill="url(#map-grid)" opacity="0.65" />
            <path
              d="M230 58 C365 28 565 50 704 132 C802 190 836 302 787 404 C732 518 562 548 392 511 C222 475 110 364 132 240 C146 154 169 91 230 58Z"
              fill="#e7f3eb"
              stroke="#b7d2c0"
              strokeWidth="2"
              opacity="0.85"
            />

            {drawableRecommendations.map((recommendation) => {
              const origin = project(recommendation.origin_latitude, recommendation.origin_longitude);
              const destination = project(recommendation.destination_latitude, recommendation.destination_longitude);
              const selectedRoute = recommendation.id === selected.id;

              return (
                <g
                  key={recommendation.id}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => onSelect(recommendation.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(recommendation.id);
                    }
                  }}
                >
                    <line
                      x1={origin.x}
                      y1={origin.y}
                      x2={destination.x}
                      y2={destination.y}
                      stroke={selectedRoute ? '#ff3621' : '#4f8f75'}
                      strokeWidth={selectedRoute ? 5 : 2}
                      strokeLinecap="round"
                      opacity={selectedRoute ? 0.95 : 0.28}
                      filter={selectedRoute ? 'url(#route-shadow)' : undefined}
                    />
                    <circle
                      cx={origin.x}
                      cy={origin.y}
                      r={selectedRoute ? 13 : 6}
                      fill={selectedRoute ? '#ff3621' : '#0f7a5f'}
                      opacity={selectedRoute ? 0.95 : 0.65}
                    />
                    <rect
                      x={destination.x - (selectedRoute ? 8 : 5)}
                      y={destination.y - (selectedRoute ? 8 : 5)}
                      width={selectedRoute ? 16 : 10}
                      height={selectedRoute ? 16 : 10}
                      rx="3"
                      fill={selectedRoute ? '#0b2026' : '#64746f'}
                      opacity={selectedRoute ? 0.95 : 0.58}
                    />
                    <title>
                      {recommendation.origin_region} to {recommendation.destination_facility_name}
                    </title>
                </g>
              );
            })}

            <circle
              cx={selectedOrigin.x}
              cy={selectedOrigin.y}
              r="30"
              fill="none"
              stroke="#ff3621"
              strokeWidth="3"
              strokeDasharray="7 7"
              opacity="0.82"
            />
            <line
              x1={selectedOrigin.x}
              y1={selectedOrigin.y}
              x2={selectedDestination.x}
              y2={selectedDestination.y}
              stroke="#ff3621"
              strokeWidth="6"
              strokeLinecap="round"
              opacity="0.9"
            />
            <circle cx={selectedOrigin.x} cy={selectedOrigin.y} r="11" fill="#ff3621" />
            <rect
              x={selectedDestination.x - 9}
              y={selectedDestination.y - 9}
              width="18"
              height="18"
              rx="4"
              fill="#0b2026"
            />

            <g transform={`translate(${Math.min(selectedOrigin.x + 18, width - 245)} ${Math.max(selectedOrigin.y - 26, 44)})`}>
              <rect width="228" height="58" rx="8" fill="#fffdf9" stroke="#d9d4cc" />
              <text x="14" y="24" fill="#0b2026" fontSize="16" fontWeight="700">
                {selected.origin_region}
              </text>
              <text x="14" y="44" fill="#5f6b6f" fontSize="13">
                {formatDistance(selected.distance_saved_km)} saved
              </text>
            </g>
          </svg>

          <div className="absolute bottom-4 left-4 grid gap-2 rounded-lg border border-border/60 bg-card/95 p-3 text-xs text-muted-foreground shadow-sm">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-primary" />
              District origin
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-[3px] bg-foreground" />
              Destination facility
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RecommendationDetails({ recommendation }: { recommendation: ShuttleRecommendation | null }) {
  if (!recommendation) {
    return (
      <Card className="border-border/60 bg-card/90 shadow-none">
        <CardContent className="p-0">
          <Empty className="min-h-[24rem] justify-center p-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Route className="h-5 w-5" />
              </EmptyMedia>
              <EmptyTitle>Select a shuttle stop</EmptyTitle>
              <EmptyDescription>
                Pick a recommendation to inspect demand signals, destination fit, and the modeled travel savings.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  const signals = parseSignals(recommendation.top_contributing_signals);

  return (
    <Card className="border-border/60 bg-card/90 shadow-none">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{recommendation.treatment}</Badge>
          <Badge variant="outline">{recommendation.snapshot_mode}</Badge>
        </div>
        <CardTitle className="text-2xl">
          {recommendation.origin_region} to {recommendation.destination_facility_name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Origin</p>
            <p className="text-foreground">{formatLocation([recommendation.origin_region, recommendation.origin_state])}</p>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Destination</p>
            <p className="text-foreground">
              {formatLocation([
                recommendation.destination_city,
                recommendation.destination_state,
                recommendation.destination_country,
              ])}
            </p>
          </div>
        </div>

        <Separator />

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Current</p>
            <p className="text-xl font-semibold text-foreground">
              {formatDistance(recommendation.current_distance_km)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Recommended</p>
            <p className="text-xl font-semibold text-foreground">
              {formatDistance(recommendation.recommended_distance_km)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Reduced</p>
            <p className="text-xl font-semibold text-foreground">
              {formatPercent(recommendation.transportation_burden_reduction_pct)}
            </p>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Why this region</p>
          <p className="leading-6 text-foreground">{recommendation.why_region}</p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Why this facility</p>
          <p className="leading-6 text-foreground">{recommendation.why_facility}</p>
        </div>

        {signals.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Top signals</p>
            <div className="space-y-2">
              {signals.map((signal) => (
                <div key={signal.signal} className="flex items-center justify-between gap-3 rounded-lg bg-secondary/70 px-3 py-2">
                  <span className="font-medium text-foreground">{signal.signal}</span>
                  <Badge variant="outline">{Math.round(signal.weight * 100)}%</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        <Separator />

        <div className="space-y-2 text-xs text-muted-foreground">
          <p>Demand score: {formatScore(recommendation.demand_score)}</p>
          <p>Facility ID: {recommendation.destination_facility_id || 'Pipeline-selected destination'}</p>
          <p>Pipeline version: {recommendation.source_pipeline_version}</p>
          <p>Updated: {formatTimestamp(recommendation.updated_at)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function PrioritizationPage() {
  const [summary, setSummary] = useState<RecommendationSummary | null>(null);
  const [options, setOptions] = useState<TreatmentOptionsResponse | null>(null);
  const [recommendations, setRecommendations] = useState<ShuttleRecommendation[]>([]);
  const [selectedTreatment, setSelectedTreatment] = useState('all');
  const [maxDistanceSavedKm, setMaxDistanceSavedKm] = useState('');
  const [selectedRecommendationId, setSelectedRecommendationId] = useState<string | null>(null);
  const [loadingHeader, setLoadingHeader] = useState(true);
  const [loadingRecommendations, setLoadingRecommendations] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadHeader() {
      setLoadingHeader(true);
      try {
        const [summaryPayload, optionsPayload] = await Promise.all([
          fetchJson<RecommendationSummary>('/api/prioritization/summary'),
          fetchJson<TreatmentOptionsResponse>('/api/prioritization/treatments'),
        ]);

        if (!active) {
          return;
        }

        setSummary(summaryPayload);
        setOptions(optionsPayload);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load prioritization overview.');
        }
      } finally {
        if (active) {
          setLoadingHeader(false);
        }
      }
    }

    void loadHeader();

    return () => {
      active = false;
    };
  }, [refreshMessage]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadRecommendations() {
      setLoadingRecommendations(true);
      try {
        const params = new URLSearchParams({
          treatment: selectedTreatment,
          limit: '24',
        });
        if (maxDistanceSavedKm.trim()) {
          params.set('maxDistanceSavedKm', maxDistanceSavedKm.trim());
        }
        const payload = await fetchJson<RecommendationsResponse>(
          `/api/prioritization/recommendations?${params.toString()}`,
          { signal: controller.signal },
        );

        setRecommendations(payload.recommendations);
        setSelectedRecommendationId((currentId) => {
          if (payload.recommendations.some((recommendation) => recommendation.id === currentId)) {
            return currentId;
          }

          return payload.recommendations[0]?.id ?? null;
        });
        setError(null);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load shuttle recommendations.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingRecommendations(false);
        }
      }
    }

    void loadRecommendations();

    return () => {
      controller.abort();
    };
  }, [selectedTreatment, maxDistanceSavedKm, refreshMessage]);

  const selectedRecommendation = useMemo(
    () => recommendations.find((recommendation) => recommendation.id === selectedRecommendationId) ?? null,
    [recommendations, selectedRecommendationId],
  );

  const currentTreatment = selectedTreatment === 'all' ? 'All treatments' : selectedTreatment;

  async function refreshDemoRecommendations() {
    setRefreshing(true);
    setRefreshMessage(null);
    try {
      const payload = await fetchJson<RefreshResponse>('/api/prioritization/refresh-demo', { method: 'POST' });
      setRefreshMessage(`Demo snapshot refreshed: ${payload.loadedRows} routes at ${formatTimestamp(payload.updatedAt)}.`);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to refresh demo recommendations.');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1.25fr_0.85fr]">
        <div className="space-y-5 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Precomputed recommendation table</Badge>
            <Badge variant="secondary">Shuttle coordination view</Badge>
          </div>
          <div className="space-y-3">
            <h2 className="max-w-4xl text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              Select a treatment and route patients toward realistic specialty destinations.
            </h2>
            <p className="max-w-3xl text-base leading-7 text-muted-foreground">
              Recommendations are served from Lakebase so the app stays quick during demos while the Python pipeline can
              refresh the table when facility, survey, or geography inputs change.
            </p>
          </div>
        </div>

        <Card className="border-border/60 bg-card/90 shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Recommendation snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {loadingHeader ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : (
              <>
                <div>
                  <p className="font-medium text-foreground">Latest update</p>
                  <p className="text-muted-foreground">{formatTimestamp(summary?.latestUpdatedAt ?? null)}</p>
                </div>
                <div>
                  <p className="font-medium text-foreground">Top route</p>
                  <p className="leading-6 text-muted-foreground">
                    {summary?.topRecommendation
                      ? `${summary.topRecommendation.origin_region}, ${summary.topRecommendation.origin_state} to ${summary.topRecommendation.destination_facility_name}`
                      : 'No recommendation loaded yet'}
                  </p>
                </div>
                <Button onClick={() => void refreshDemoRecommendations()} disabled={refreshing} className="w-full">
                  <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                  {refreshing ? 'Refreshing demo' : 'Refresh demo snapshot'}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Prioritization data unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {refreshMessage && (
        <Alert>
          <Sparkles className="h-4 w-4" />
          <AlertTitle>Snapshot refreshed</AlertTitle>
          <AlertDescription>{refreshMessage}</AlertDescription>
        </Alert>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {loadingHeader ? (
          Array.from({ length: 4 }, (_, index) => (
            <Card key={index} className="border-border/60">
              <CardHeader className="space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-20" />
              </CardHeader>
            </Card>
          ))
        ) : (
          <>
            <MetricCard
              label="Recommended routes"
              value={formatNumber(summary?.totalRecommendations ?? 0)}
              icon={Route}
            />
            <MetricCard label="Treatments" value={formatNumber(summary?.treatments ?? 0)} icon={HeartPulse} />
            <MetricCard
              label="People affected"
              value={formatNumber(summary?.estimatedPeopleAffected ?? 0)}
              icon={Users}
            />
            <MetricCard
              label="Avg burden reduced"
              value={formatPercent(summary?.averageBurdenReductionPct ?? 0)}
              icon={Gauge}
            />
          </>
        )}
      </section>

      <section className="grid gap-4 rounded-lg border border-border/60 bg-card/80 p-4 lg:grid-cols-[1fr_18rem_15rem_auto] lg:items-end">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Route filters</p>
          <p className="text-sm text-muted-foreground">
            Showing {currentTreatment.toLowerCase()} routes
            {maxDistanceSavedKm.trim() ? ` with at most ${formatDistance(maxDistanceSavedKm)} saved.` : '.'}
          </p>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Treatment</p>
          <Select value={selectedTreatment} onValueChange={setSelectedTreatment}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose treatment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All treatments</SelectItem>
              {options?.treatments.map((treatment) => (
                <SelectItem key={treatment.value} value={treatment.value}>
                  {treatment.value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Max saved</p>
          <Input
            type="number"
            min="0"
            step="25"
            inputMode="numeric"
            value={maxDistanceSavedKm}
            onChange={(event) => setMaxDistanceSavedKm(event.target.value)}
            placeholder="Any km"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setSelectedTreatment('all');
            setMaxDistanceSavedKm('');
          }}
        >
          Reset
        </Button>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div>
          {loadingRecommendations ? (
            <Card className="border-border/60">
              <CardHeader className="space-y-3">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-96 max-w-full" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-[30rem] w-full" />
              </CardContent>
            </Card>
          ) : (
            <RouteMapView
              recommendations={recommendations}
              selectedRecommendation={selectedRecommendation}
              onSelect={setSelectedRecommendationId}
            />
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold tracking-tight text-foreground">Mapped routes</h3>
              <p className="text-sm text-muted-foreground">Select a route to highlight its district and shuttle path.</p>
            </div>
            <Badge variant="outline">{recommendations.length}</Badge>
          </div>

          {loadingRecommendations &&
            Array.from({ length: 4 }, (_, index) => (
              <Card key={index} className="border-border/60">
                <CardHeader className="space-y-3">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-6 w-full" />
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </CardContent>
              </Card>
            ))}

          {!loadingRecommendations && recommendations.length === 0 && (
            <Empty className="rounded-lg border border-dashed border-border/80 py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Bus className="h-5 w-5" />
                </EmptyMedia>
                <EmptyTitle>No routes match the filters</EmptyTitle>
                <EmptyDescription>Increase the maximum saved distance or choose another treatment.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          <div className="max-h-[34rem] space-y-3 overflow-auto pr-1">
            {!loadingRecommendations &&
              recommendations.map((recommendation) => (
                <RecommendationCard
                  key={recommendation.id}
                  recommendation={recommendation}
                  selected={recommendation.id === selectedRecommendationId}
                  onSelect={() => setSelectedRecommendationId(recommendation.id)}
                />
              ))}
          </div>
        </div>
      </section>

      <RecommendationDetails recommendation={selectedRecommendation} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground">Route list</h3>
            <p className="text-sm text-muted-foreground">A compact operating view for comparing candidate shuttle routes.</p>
          </div>
          <Badge variant="outline">
            <Clock3 className="h-3.5 w-3.5" />
            {formatTimestamp(summary?.latestUpdatedAt ?? null)}
          </Badge>
        </div>

        <div className="overflow-hidden rounded-lg border border-border/60 bg-card/90">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Origin</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Treatment</TableHead>
                <TableHead>People</TableHead>
                <TableHead>Travel saved</TableHead>
                <TableHead>Priority</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recommendations.map((recommendation) => (
                <TableRow
                  key={recommendation.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedRecommendationId(recommendation.id)}
                >
                  <TableCell>
                    <div className="font-medium text-foreground">{recommendation.origin_region}</div>
                    <div className="text-xs text-muted-foreground">{recommendation.origin_state}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-foreground">{recommendation.destination_facility_name}</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPinned className="h-3.5 w-3.5" />
                      {formatLocation([recommendation.destination_city, recommendation.destination_state])}
                    </div>
                  </TableCell>
                  <TableCell>{recommendation.treatment}</TableCell>
                  <TableCell>{formatNumber(recommendation.estimated_people_affected)}</TableCell>
                  <TableCell>
                    {formatDistance(recommendation.distance_saved_km)}
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({formatPercent(recommendation.transportation_burden_reduction_pct)})
                    </span>
                  </TableCell>
                  <TableCell>{formatScore(recommendation.priority_score)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
