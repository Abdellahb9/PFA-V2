// Guards protected routes. `staffOnly` restricts to admin/recruiter (candidates
// are redirected to their own portal).
import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAppSelector } from "@/store";

interface Props {
  children: ReactNode;
  staffOnly?: boolean;
}

export default function ProtectedRoute({ children, staffOnly }: Props) {
  const { isAuthenticated, user } = useAppSelector((s) => s.auth);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (staffOnly && user?.role === "candidate") return <Navigate to="/mon-espace" replace />;
  return <>{children}</>;
}
