// Route definitions: public login + protected dashboard area.
// LoginPage is imported statically (no Suspense before login -> no splash for
// logged-out users). Internal pages are lazy-loaded; their Suspense fallback
// lives in the layout (around <Outlet/>), and an ErrorBoundary wraps everything
// so a failed chunk never leaves an infinite loader.
import { lazy, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import AppLayout from "@/components/Layout";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLoader from "@/components/AppLoader";
import ErrorBoundary from "@/components/ErrorBoundary";
import LoginPage from "@/pages/LoginPage";
import LandingPage from "@/pages/LandingPage";
import { ACCESS_TOKEN_KEY } from "@/api/client";
import { useAppDispatch } from "@/store";
import { fetchMe } from "@/store/authSlice";

// Internal pages are code-split (only reachable once authenticated).
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const CandidatesPage = lazy(() => import("@/pages/CandidatesPage"));
const DepartmentsPage = lazy(() => import("@/pages/DepartmentsPage"));
const OffersPage = lazy(() => import("@/pages/OffersPage"));
const ApplicationsPage = lazy(() => import("@/pages/ApplicationsPage"));
const MatchingPage = lazy(() => import("@/pages/MatchingPage"));

export default function App() {
  const dispatch = useAppDispatch();
  // Only "boot" (show the splash) when there is actually a session to hydrate.
  // No token -> false from the very first render -> straight to the routes.
  const [booting, setBooting] = useState(
    () => Boolean(localStorage.getItem(ACCESS_TOKEN_KEY))
  );

  useEffect(() => {
    if (!localStorage.getItem(ACCESS_TOKEN_KEY)) return; // nothing to hydrate
    // Safety net: never stay on the splash for more than a few seconds, even if
    // the request hangs (network/proxy issue).
    const safety = window.setTimeout(() => setBooting(false), 6000);
    // `.finally` runs on BOTH success and failure (RTK thunks never reject).
    dispatch(fetchMe()).finally(() => {
      window.clearTimeout(safety);
      setBooting(false);
    });
    return () => window.clearTimeout(safety);
  }, [dispatch]);

  if (booting) return <AppLoader />;

  return (
    <ErrorBoundary>
      <Routes>
        {/* Public routes (static imports -> no Suspense, no splash). */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          {/* Lazy internal pages: their Suspense fallback is the layout's
              <Suspense> around <Outlet/> (the sidebar stays visible). */}
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/candidatures" element={<ApplicationsPage />} />
          <Route path="/candidats" element={<CandidatesPage />} />
          <Route path="/departements" element={<DepartmentsPage />} />
          <Route path="/offres" element={<OffersPage />} />
          <Route path="/matching" element={<MatchingPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
