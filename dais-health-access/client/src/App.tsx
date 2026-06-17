import { Navigate, RouterProvider, createBrowserRouter } from 'react-router';
import { useEffect } from 'react';
import { Badge } from '@databricks/appkit-ui/react';
import { Bus, HeartPulse, Route } from 'lucide-react';
import { PrioritizationPage } from './pages/PrioritizationPage';

function Layout() {
  useEffect(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
    document.title = 'HospiShuttle';
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pb-10 pt-4 md:px-6 lg:px-8">
        <header className="sticky top-4 z-20 mb-6 rounded-lg border border-border/60 bg-background/90 px-5 py-4 shadow-[0_24px_60px_-44px_rgba(11,32,38,0.65)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Bus className="h-5 w-5" />
              </span>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                  Specialty care shuttle planner
                </p>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">HospiShuttle</h1>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1.5">
                <Route className="h-3.5 w-3.5" />
                Route prioritization
              </Badge>
              <Badge variant="secondary" className="gap-1.5">
                <HeartPulse className="h-3.5 w-3.5" />
                Lakebase snapshot
              </Badge>
            </div>
          </div>
        </header>

        <main className="flex-1">
          <PrioritizationPage />
        </main>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/', element: <Layout /> },
  { path: '/prioritization', element: <Layout /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
