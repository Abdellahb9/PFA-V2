// Routing: public landing + login, protected admin area (Supabase Auth).
import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import AppLayout from "@/components/Layout";
import BackgroundLayer from "@/components/BackgroundLayer";
import ProtectedRoute from "@/components/ProtectedRoute";
import { SHOW_CONSTELLATION } from "@/config";
import AppLoader from "@/components/AppLoader";
import ErrorBoundary from "@/components/ErrorBoundary";
import LoginPage from "@/pages/LoginPage";
import SignupPage from "@/pages/SignupPage";
import LandingPage from "@/pages/LandingPage";
import CandidatePortalPage from "@/pages/CandidatePortalPage";
import { supabase } from "@/lib/supabase";
import { useAppDispatch } from "@/store";
import { fetchMe, sessionCleared } from "@/store/authSlice";

const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const CandidatesPage = lazy(() => import("@/pages/CandidatesPage"));
const DepartmentsPage = lazy(() => import("@/pages/DepartmentsPage"));
const OffersPage = lazy(() => import("@/pages/OffersPage"));
const ApplicationsPage = lazy(() => import("@/pages/ApplicationsPage"));
const MatchingPage = lazy(() => import("@/pages/MatchingPage"));
const UsersPage = lazy(() => import("@/pages/UsersPage"));
const AssistantPage = lazy(() => import("@/pages/AssistantPage"));
const BookingsPage = lazy(() => import("@/pages/BookingsPage"));
// Dev-only visual preview of the dashboard (mock data, no auth).
const DevPreviewDashboard = import.meta.env.DEV
  ? lazy(() => import("@/pages/DevPreviewDashboard"))
  : null;
// Dev-only preview of the booked-offers page + the apply modal (mock data).
const DevPreviewBookings = import.meta.env.DEV
  ? lazy(() => import("@/pages/DevPreviewBookings"))
  : null;

// Detect a persisted Supabase session synchronously to avoid a splash flash
// for logged-out visitors (the token lives under an `sb-*-auth-token` key).
const hasPersistedSession = () =>
  Object.keys(localStorage).some((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));

export default function App() {
  const dispatch = useAppDispatch();
  const [booting, setBooting] = useState(hasPersistedSession);

  useEffect(() => {
    if (hasPersistedSession()) {
      const safety = window.setTimeout(() => setBooting(false), 6000);
      dispatch(fetchMe()).finally(() => {
        window.clearTimeout(safety);
        setBooting(false);
      });
    }
    // Keep Redux in sync if the session ends elsewhere.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      // Only clear local state here — do NOT call signOut again (that would
      // re-fire SIGNED_OUT and loop, freezing the page).
      if (event === "SIGNED_OUT") dispatch(sessionCleared());
    });
    return () => sub.subscription.unsubscribe();
  }, [dispatch]);

  if (booting) return <AppLoader />;

  return (
    <ErrorBoundary>
      {SHOW_CONSTELLATION && <BackgroundLayer />}
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/inscription" element={<SignupPage />} />
        {/* Candidate portal (any authenticated user). */}
        <Route
          path="/mon-espace"
          element={
            <ProtectedRoute>
              <CandidatePortalPage />
            </ProtectedRoute>
          }
        />
        {/* Admin area — staff only (candidates are redirected to /mon-espace). */}
        <Route
          element={
            <ProtectedRoute staffOnly>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/candidatures" element={<ApplicationsPage />} />
          <Route path="/candidats" element={<CandidatesPage />} />
          <Route path="/departements" element={<DepartmentsPage />} />
          <Route path="/offres" element={<OffersPage />} />
          <Route path="/matching" element={<MatchingPage />} />
          <Route path="/assistant" element={<AssistantPage />} />
          <Route path="/reservations" element={<BookingsPage />} />
          <Route path="/utilisateurs" element={<UsersPage />} />
        </Route>
        {DevPreviewDashboard && (
          <Route
            path="/__preview/dashboard"
            element={
              <Suspense fallback={null}>
                <DevPreviewDashboard />
              </Suspense>
            }
          />
        )}
        {DevPreviewBookings && (
          <Route
            path="/__preview/reservations"
            element={
              <Suspense fallback={null}>
                <DevPreviewBookings />
              </Suspense>
            }
          />
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
