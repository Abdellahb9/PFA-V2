// Routing: public landing + login, protected admin area (Supabase Auth).
import { lazy, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import AppLayout from "@/components/Layout";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLoader from "@/components/AppLoader";
import ErrorBoundary from "@/components/ErrorBoundary";
import LoginPage from "@/pages/LoginPage";
import SignupPage from "@/pages/SignupPage";
import LandingPage from "@/pages/LandingPage";
import CandidatePortalPage from "@/pages/CandidatePortalPage";
import { supabase } from "@/lib/supabase";
import { useAppDispatch } from "@/store";
import { fetchMe, logout } from "@/store/authSlice";

const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const CandidatesPage = lazy(() => import("@/pages/CandidatesPage"));
const DepartmentsPage = lazy(() => import("@/pages/DepartmentsPage"));
const OffersPage = lazy(() => import("@/pages/OffersPage"));
const ApplicationsPage = lazy(() => import("@/pages/ApplicationsPage"));
const MatchingPage = lazy(() => import("@/pages/MatchingPage"));

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
      if (event === "SIGNED_OUT") dispatch(logout());
    });
    return () => sub.subscription.unsubscribe();
  }, [dispatch]);

  if (booting) return <AppLoader />;

  return (
    <ErrorBoundary>
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
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
