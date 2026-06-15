import { useDeferredValue, useEffect, useMemo, useState, startTransition } from 'react';
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
  EmptyContent,
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useIsMobile,
} from '@databricks/appkit-ui/react';
import {
  Globe2,
  HeartPulse,
  LoaderCircle,
  MapPin,
  Phone,
  Search,
} from 'lucide-react';

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

interface FilterOption {
  value: string;
  count: number;
}

interface FilterOptionsResponse {
  countries: FilterOption[];
  cities: FilterOption[];
  organizationTypes: FilterOption[];
}

interface FacilityRecord {
  unique_id: string;
  name: string;
  organization_type: string | null;
  official_phone: string | null;
  official_website: string | null;
  email: string | null;
  address_city: string | null;
  address_state_or_region: string | null;
  address_country: string | null;
  facility_type_id: string | null;
  specialties: string | null;
  description: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  source: string | null;
  source_urls: string | null;
  loaded_at: string;
}

interface FacilitiesResponse {
  total: number;
  limit: number;
  offset: number;
  facilities: FacilityRecord[];
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

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', { notation: 'compact' }).format(value);
}

function formatLocation(facility: FacilityRecord) {
  return [facility.address_city, facility.address_state_or_region, facility.address_country]
    .filter(Boolean)
    .join(', ');
}

function formatCoordinates(value: number | string | null) {
  if (value === null || value === undefined || value === '') {
    return 'Unavailable';
  }

  return Number(value).toFixed(4);
}

function formatMaybe(value: string | null | undefined) {
  return value && value.trim().length > 0 ? value : 'Unavailable';
}

async function fetchJson<T>(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  const payload = (await response.json()) as T | { error?: string; guidance?: string };

  if (!response.ok) {
    const problem = payload as { error?: string; guidance?: string };
    throw new Error(problem.guidance ? `${problem.error} ${problem.guidance}` : problem.error || 'Request failed.');
  }

  return payload as T;
}

function DetailPanel({ facility }: { facility: FacilityRecord | null }) {
  if (!facility) {
    return (
      <Card className="border-border/60 bg-card/90 shadow-none">
        <CardContent className="p-0">
          <Empty className="min-h-[22rem] justify-center p-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HeartPulse className="h-5 w-5" />
              </EmptyMedia>
              <EmptyTitle>Select a facility</EmptyTitle>
              <EmptyDescription>
                Pick a result to see the provider profile, location, contact details, and Lakebase-backed snapshot metadata.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60 bg-card/90 shadow-none">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{formatMaybe(facility.organization_type)}</Badge>
          <Badge variant="outline">{formatMaybe(facility.address_country)}</Badge>
        </div>
        <CardTitle className="text-2xl">{facility.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Location</p>
          <p className="leading-6 text-foreground">{formatLocation(facility) || 'Unavailable'}</p>
          <p className="text-muted-foreground">
            {formatCoordinates(facility.latitude)}, {formatCoordinates(facility.longitude)}
          </p>
        </div>

        <Separator />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Contact</p>
            <p className="text-foreground">{formatMaybe(facility.official_phone)}</p>
            <p className="break-all text-muted-foreground">{formatMaybe(facility.email)}</p>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Facility type</p>
            <p className="text-foreground">{formatMaybe(facility.facility_type_id)}</p>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Specialties</p>
          <p className="leading-6 text-foreground">{formatMaybe(facility.specialties)}</p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Description</p>
          <p className="leading-6 text-muted-foreground">{formatMaybe(facility.description)}</p>
        </div>

        <Separator />

        <div className="space-y-2 text-xs text-muted-foreground">
          <p>Source: {formatMaybe(facility.source)}</p>
          <p>Snapshot loaded: {formatTimestamp(facility.loaded_at)}</p>
          <p className="break-all">Reference URL(s): {formatMaybe(facility.source_urls)}</p>
          <p className="break-all">Unique ID: {facility.unique_id}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function FacilitiesPage() {
  const isMobile = useIsMobile();
  const [summary, setSummary] = useState<FacilitySummary | null>(null);
  const [options, setOptions] = useState<FilterOptionsResponse | null>(null);
  const [facilities, setFacilities] = useState<FacilitiesResponse | null>(null);
  const [searchDraft, setSearchDraft] = useState('');
  const [country, setCountry] = useState('all');
  const [city, setCity] = useState('all');
  const [organizationType, setOrganizationType] = useState('all');
  const [selectedFacility, setSelectedFacility] = useState<FacilityRecord | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingHeader, setLoadingHeader] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const deferredSearch = useDeferredValue(searchDraft.trim());
  const pageSize = 12;
  const [page, setPage] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadHeader() {
      setLoadingHeader(true);
      try {
        const [summaryPayload, optionsPayload] = await Promise.all([
          fetchJson<FacilitySummary>('/api/facilities/summary'),
          fetchJson<FilterOptionsResponse>('/api/facilities/options'),
        ]);

        if (!active) {
          return;
        }

        setSummary(summaryPayload);
        setOptions(optionsPayload);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load facility overview.');
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
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadFacilities() {
      setLoadingList(true);
      try {
        const params = new URLSearchParams({
          q: deferredSearch,
          country,
          city,
          organizationType,
          limit: String(pageSize),
          offset: String(page * pageSize),
        });

        const payload = await fetchJson<FacilitiesResponse>(`/api/facilities?${params.toString()}`, controller.signal);
        setFacilities(payload);
        setError(null);

        const firstFacility = payload.facilities[0] ?? null;
        setSelectedFacility((current) => {
          if (!current) {
            return firstFacility;
          }

          return payload.facilities.find((facility) => facility.unique_id === current.unique_id) ?? firstFacility;
        });
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : 'Failed to load facilities.');
      } finally {
        if (!controller.signal.aborted) {
          setLoadingList(false);
        }
      }
    }

    void loadFacilities();

    return () => controller.abort();
  }, [country, city, deferredSearch, organizationType, page]);

  const totalPages = useMemo(() => {
    if (!facilities) {
      return 0;
    }
    return Math.max(1, Math.ceil(facilities.total / pageSize));
  }, [facilities]);

  const handleSelectFacility = (facility: FacilityRecord) => {
    setSelectedFacility(facility);
    if (isMobile) {
      setDetailOpen(true);
    }
  };

  const resetPagination = () => {
    startTransition(() => {
      setPage(0);
    });
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <Card className="overflow-hidden border-border/60 bg-card/90 shadow-none">
          <CardContent className="relative p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,54,33,0.14),transparent_28%),radial-gradient(circle_at_right,rgba(11,32,38,0.1),transparent_22%)]" />
            <div className="relative space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="outline" className="bg-background/80">Facilities explorer</Badge>
                {!loadingHeader && summary && (
                  <Badge variant="secondary">{formatNumber(summary.totalFacilities)} facilities loaded</Badge>
                )}
              </div>
              <div className="space-y-3">
                <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                  Explore the healthcare access landscape with Lakebase-backed search and filtering.
                </h2>
                <p className="max-w-3xl text-base leading-7 text-muted-foreground">
                  This page reads a curated snapshot of the DAIS facilities dataset from Lakebase. It is optimized
                  for fast lookups and honest demo framing rather than warehouse-style analytics.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/90 shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Snapshot details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {loadingHeader && (
              <>
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-52" />
                <Skeleton className="h-4 w-36" />
              </>
            )}

            {!loadingHeader && summary && (
              <>
                <div>
                  <p className="text-muted-foreground">Latest import</p>
                  <p className="font-medium text-foreground">{formatTimestamp(summary.latestSnapshotAt)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Mode</p>
                  <p className="font-medium uppercase tracking-[0.18em] text-foreground">
                    {summary.snapshotMode.replace('_', ' ')}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Source table</p>
                  <p className="break-all font-medium text-foreground">{summary.sourceTable}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Explorer needs attention</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {loadingHeader &&
          Array.from({ length: 4 }, (_, index) => (
            <Card key={index} className="border-border/60">
              <CardHeader className="space-y-3">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-9 w-24" />
              </CardHeader>
            </Card>
          ))}

        {!loadingHeader &&
          summary &&
          [
            { label: 'Facilities', value: summary.totalFacilities, icon: HeartPulse },
            { label: 'Countries', value: summary.countries, icon: Globe2 },
            { label: 'Cities', value: summary.cities, icon: MapPin },
            { label: 'Org types', value: summary.organizationTypes, icon: Phone },
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
                  <p className="text-3xl font-semibold tracking-tight text-foreground">{formatNumber(stat.value)}</p>
                </CardContent>
              </Card>
            );
          })}
      </section>

      <Card className="border-border/60 bg-card/90 shadow-none">
        <CardHeader className="gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <CardTitle>Refine the dataset</CardTitle>
            <p className="text-sm text-muted-foreground">
              Search by provider, specialty, or location, then narrow the view with high-signal filters.
            </p>
          </div>
          <Badge variant="outline" className="w-fit">
            Demo snapshot
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchDraft}
              onChange={(event) => {
                setSearchDraft(event.target.value);
                resetPagination();
              }}
              placeholder="Search facilities, specialties, or cities"
              className="pl-9"
            />
          </div>

          <Select
            value={country}
            onValueChange={(value) => {
              setCountry(value);
              setCity('all');
              resetPagination();
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Country" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All countries</SelectItem>
              {options?.countries.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.value} ({option.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={city}
            onValueChange={(value) => {
              setCity(value);
              resetPagination();
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="City" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cities</SelectItem>
              {options?.cities.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.value} ({option.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={organizationType}
            onValueChange={(value) => {
              setOrganizationType(value);
              resetPagination();
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Organization type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All organization types</SelectItem>
              {options?.organizationTypes.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.value} ({option.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <section className="grid gap-6 xl:grid-cols-[1.25fr_0.9fr]">
        <div className="space-y-4">
          <Card className="border-border/60 bg-card/90 shadow-none">
            <CardHeader className="flex flex-row items-end justify-between">
              <div className="space-y-1">
                <CardTitle>Result set</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {loadingList
                    ? 'Refreshing results...'
                    : facilities
                      ? `${formatNumber(facilities.total)} matches across the current snapshot`
                      : 'No results loaded yet.'}
                </p>
              </div>
              {loadingList && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Updating
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingList && (
                <div className="space-y-3">
                  {Array.from({ length: 6 }, (_, index) => (
                    <Skeleton key={index} className="h-14 w-full" />
                  ))}
                </div>
              )}

              {!loadingList && facilities && facilities.facilities.length === 0 && (
                <Empty className="rounded-3xl border border-dashed border-border/80 py-12">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Search className="h-5 w-5" />
                    </EmptyMedia>
                    <EmptyTitle>No facilities match this view</EmptyTitle>
                    <EmptyDescription>
                      Clear one or more filters to broaden the search, or load the snapshot if the table is still empty.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSearchDraft('');
                        setCountry('all');
                        setCity('all');
                        setOrganizationType('all');
                        startTransition(() => setPage(0));
                      }}
                    >
                      Reset filters
                    </Button>
                  </EmptyContent>
                </Empty>
              )}

              {!loadingList && facilities && facilities.facilities.length > 0 && (
                <>
                  <div className="hidden overflow-hidden rounded-2xl border border-border/60 md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Facility</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Specialties</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {facilities.facilities.map((facility) => (
                          <TableRow
                            key={facility.unique_id}
                            className="cursor-pointer"
                            onClick={() => handleSelectFacility(facility)}
                          >
                            <TableCell>
                              <div className="space-y-1">
                                <p className="font-medium text-foreground">{facility.name}</p>
                                <p className="text-xs text-muted-foreground">{formatMaybe(facility.official_phone)}</p>
                              </div>
                            </TableCell>
                            <TableCell>{formatLocation(facility) || 'Unavailable'}</TableCell>
                            <TableCell>{formatMaybe(facility.organization_type)}</TableCell>
                            <TableCell className="max-w-xs truncate">{formatMaybe(facility.specialties)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="space-y-3 md:hidden">
                    {facilities.facilities.map((facility) => (
                      <button
                        key={facility.unique_id}
                        type="button"
                        onClick={() => handleSelectFacility(facility)}
                        className="w-full rounded-2xl border border-border/60 bg-background p-4 text-left"
                      >
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">{formatMaybe(facility.organization_type)}</Badge>
                            <Badge variant="outline">{formatMaybe(facility.address_country)}</Badge>
                          </div>
                          <p className="text-base font-medium text-foreground">{facility.name}</p>
                          <p className="text-sm text-muted-foreground">{formatLocation(facility) || 'Unavailable'}</p>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-muted-foreground">
                      Page {page + 1} of {Math.max(totalPages, 1)}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        disabled={!facilities || page + 1 >= totalPages}
                        onClick={() => setPage((current) => current + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="hidden xl:block">
          <div className="sticky top-6">
            <DetailPanel facility={selectedFacility} />
          </div>
        </div>
      </section>

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent side="right" className="w-full max-w-xl overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>Facility profile</SheetTitle>
          </SheetHeader>
          <DetailPanel facility={selectedFacility} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
