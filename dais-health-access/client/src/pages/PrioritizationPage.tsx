import type * as Leaflet from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
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
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const routeLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const drawableRecommendations = useMemo(() => recommendations.filter(hasRouteCoordinates), [recommendations]);
  const selected =
    selectedRecommendation && hasRouteCoordinates(selectedRecommendation)
      ? selectedRecommendation
      : drawableRecommendations[0] ?? null;

  useEffect(() => {
    let active = true;

    async function initializeMap() {
      if (!mapContainerRef.current || mapRef.current) {
        return;
      }

      const leaflet = await import('leaflet');
      if (!active || !mapContainerRef.current) {
        return;
      }

      leafletRef.current = leaflet;
      const map = leaflet
        .map(mapContainerRef.current, {
          center: [22.9, 79.6],
          zoom: 5,
          minZoom: 4,
          maxZoom: 10,
          scrollWheelZoom: true,
          zoomControl: true,
        })
        .setMaxBounds([
          [4, 64],
          [39, 100],
        ]);

      leaflet
        .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19,
        })
        .addTo(map);

      routeLayerRef.current = leaflet.layerGroup().addTo(map);
      mapRef.current = map;
    }

    void initializeMap();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const leaflet = leafletRef.current;
    const routeLayer = routeLayerRef.current;

    if (!map || !leaflet || !routeLayer) {
      return;
    }

    routeLayer.clearLayers();

    drawableRecommendations.forEach((recommendation) => {
      const selectedRoute = recommendation.id === selected?.id;
      const origin: Leaflet.LatLngExpression = [
        toNumber(recommendation.origin_latitude),
        toNumber(recommendation.origin_longitude),
      ];
      const destination: Leaflet.LatLngExpression = [
        toNumber(recommendation.destination_latitude),
        toNumber(recommendation.destination_longitude),
      ];
      const line = leaflet
        .polyline([origin, destination], {
          color: selectedRoute ? '#ff3621' : '#2f7d64',
          weight: selectedRoute ? 5 : 2,
          opacity: selectedRoute ? 0.95 : 0.36,
        })
        .bindTooltip(`${recommendation.origin_region} to ${recommendation.destination_facility_name}`)
        .on('click', () => onSelect(recommendation.id));
      const originMarker = leaflet
        .circleMarker(origin, {
          radius: selectedRoute ? 10 : 6,
          color: selectedRoute ? '#ff3621' : '#0f7a5f',
          fillColor: selectedRoute ? '#ff3621' : '#0f7a5f',
          fillOpacity: selectedRoute ? 0.95 : 0.7,
          weight: selectedRoute ? 3 : 1,
        })
        .bindPopup(
          `<strong>${recommendation.origin_region}</strong><br/>${formatLocation([
            recommendation.origin_state,
          ])}<br/>${formatDistance(recommendation.distance_saved_km)} saved`,
        )
        .on('click', () => onSelect(recommendation.id));
      const destinationMarker = leaflet
        .circleMarker(destination, {
          radius: selectedRoute ? 8 : 5,
          color: selectedRoute ? '#0b2026' : '#52645f',
          fillColor: selectedRoute ? '#0b2026' : '#52645f',
          fillOpacity: selectedRoute ? 0.95 : 0.62,
          weight: selectedRoute ? 3 : 1,
        })
        .bindPopup(
          `<strong>${recommendation.destination_facility_name}</strong><br/>${formatLocation([
            recommendation.destination_city,
            recommendation.destination_state,
          ])}`,
        )
        .on('click', () => onSelect(recommendation.id));

      line.addTo(routeLayer);
      originMarker.addTo(routeLayer);
      destinationMarker.addTo(routeLayer);
    });

    if (selected) {
      const selectedBounds = leaflet.latLngBounds(
        [
          [
            toNumber(selected.origin_latitude),
            toNumber(selected.origin_longitude),
          ],
          [
            toNumber(selected.destination_latitude),
            toNumber(selected.destination_longitude),
          ],
        ] as Leaflet.LatLngExpression[],
      );
      map.fitBounds(selectedBounds.pad(0.75), {
        animate: true,
        maxZoom: 7,
      });
    } else if (drawableRecommendations.length > 0) {
      const allPoints = drawableRecommendations.flatMap((recommendation) => [
        [
          toNumber(recommendation.origin_latitude),
          toNumber(recommendation.origin_longitude),
        ],
        [
          toNumber(recommendation.destination_latitude),
          toNumber(recommendation.destination_longitude),
        ],
      ]) as Leaflet.LatLngExpression[];
      map.fitBounds(leaflet.latLngBounds(allPoints).pad(0.2), {
        animate: true,
        maxZoom: 6,
      });
    }
  }, [drawableRecommendations, onSelect, selected]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      routeLayerRef.current = null;
    };
  }, []);

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
        <div className="relative overflow-hidden rounded-lg border border-border/60 bg-[#eef4f0]">
          <div ref={mapContainerRef} className="h-[32rem] w-full" aria-label="Interactive India route map" />
          <div className="absolute left-4 top-4 max-w-xs rounded-lg border border-border/60 bg-card/95 p-3 text-sm shadow-sm">
            <p className="font-semibold text-foreground">{selected?.origin_region}</p>
            <p className="text-xs leading-5 text-muted-foreground">
              {selected
                ? `${formatDistance(selected.distance_saved_km)} saved to ${selected.destination_facility_name}`
                : 'Select a route'}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="absolute right-4 top-4"
            onClick={() => {
              mapRef.current?.setView([22.9, 79.6], 5, { animate: true });
            }}
          >
            Reset India
          </Button>
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
