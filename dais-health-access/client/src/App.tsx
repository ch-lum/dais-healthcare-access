import { NavLink, Outlet, RouterProvider, createBrowserRouter } from 'react-router';
import { useState } from 'react';
import { Badge, Button, Sheet, SheetContent, SheetHeader, SheetTitle } from '@databricks/appkit-ui/react';
import { Menu } from 'lucide-react';
import { FacilitiesPage } from './pages/FacilitiesPage';
import { HomePage } from './pages/HomePage';
import { PrioritizationPage } from './pages/PrioritizationPage';

const desktopLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-4 py-2 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-primary text-primary-foreground shadow-sm'
      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
  }`;

const mobileLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-2xl px-4 py-3 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-primary text-primary-foreground shadow-sm'
      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
  }`;

type NavLinkClass = (props: { isActive: boolean }) => string;

function Navigation({
  className,
  linkClass,
  onClick,
}: {
  className?: string;
  linkClass: NavLinkClass;
  onClick?: () => void;
}) {
  return (
    <nav className={className}>
      <NavLink to="/" end className={linkClass} onClick={onClick}>
        Overview
      </NavLink>
      <NavLink to="/explorer" className={linkClass} onClick={onClick}>
        Explorer
      </NavLink>
      <NavLink to="/prioritization" className={linkClass} onClick={onClick}>
        Prioritization
      </NavLink>
    </nav>
  );
}

function Layout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pb-10 pt-4 md:px-6 lg:px-8">
        <header className="sticky top-4 z-20 mb-6 rounded-[1.75rem] border border-border/60 bg-background/85 px-5 py-4 shadow-[0_24px_60px_-44px_rgba(11,32,38,0.65)] backdrop-blur">
          <div className="flex items-center gap-4">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                Databricks App + Lakebase
              </p>
              <h1 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
                Health Access Atlas
              </h1>
            </div>

            <div className="hidden md:flex md:flex-1 md:justify-center">
              <Navigation className="flex items-center gap-2 rounded-full bg-secondary/75 p-1" linkClass={desktopLinkClass} />
            </div>

            <div className="ml-auto hidden items-center gap-2 md:flex">
              <Badge variant="outline">DAIS 2026</Badge>
              <Badge variant="secondary">Lakebase snapshot demo</Badge>
            </div>

            <div className="ml-auto md:hidden">
              <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                <Button variant="ghost" size="icon" onClick={() => setMobileNavOpen(true)}>
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Open navigation</span>
                </Button>
                <SheetContent side="left">
                  <SheetHeader className="mb-5">
                    <SheetTitle>Health Access Atlas</SheetTitle>
                  </SheetHeader>
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">DAIS 2026</Badge>
                      <Badge variant="secondary">Lakebase snapshot demo</Badge>
                    </div>
                    <Navigation className="flex flex-col gap-2" linkClass={mobileLinkClass} onClick={() => setMobileNavOpen(false)} />
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </header>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/explorer', element: <FacilitiesPage /> },
      { path: '/prioritization', element: <PrioritizationPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
