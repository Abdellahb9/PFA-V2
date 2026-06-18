// Guards protected routes: redirects to /login when unauthenticated.
import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAppSelector } from "@/store";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAppSelector((s) => s.auth);
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
