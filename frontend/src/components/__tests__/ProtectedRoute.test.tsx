import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// authSlice imports the Supabase browser client at module level; the tests
// never touch the network, so stub the module out entirely.
vi.mock("@/lib/supabase", () => ({ supabase: {}, STORAGE_BUCKET: "documents" }));

import ProtectedRoute from "@/components/ProtectedRoute";
import authReducer, { type AppUser } from "@/store/authSlice";

function renderProtected(
  authState: { isAuthenticated: boolean; user: AppUser | null },
  staffOnly = false,
) {
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: {
      auth: { ...authState, loading: false, error: null },
    },
  });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/protected"]}>
        <Routes>
          <Route
            path="/protected"
            element={
              <ProtectedRoute staffOnly={staffOnly}>
                <div>contenu-protégé</div>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<div>page-login</div>} />
          <Route path="/mon-espace" element={<div>portail-candidat</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

const staffUser: AppUser = {
  id: "u1",
  email: "admin@test.local",
  full_name: "Admin",
  role: "admin",
};

const candidateUser: AppUser = { ...staffUser, id: "u2", role: "candidate" };

describe("ProtectedRoute", () => {
  it("redirects unauthenticated visitors to /login", () => {
    renderProtected({ isAuthenticated: false, user: null });
    expect(screen.getByText("page-login")).toBeInTheDocument();
    expect(screen.queryByText("contenu-protégé")).not.toBeInTheDocument();
  });

  it("renders children for authenticated staff", () => {
    renderProtected({ isAuthenticated: true, user: staffUser }, true);
    expect(screen.getByText("contenu-protégé")).toBeInTheDocument();
  });

  it("redirects candidates away from staff-only routes", () => {
    renderProtected({ isAuthenticated: true, user: candidateUser }, true);
    expect(screen.getByText("portail-candidat")).toBeInTheDocument();
    expect(screen.queryByText("contenu-protégé")).not.toBeInTheDocument();
  });

  it("lets candidates access non staff-only routes", () => {
    renderProtected({ isAuthenticated: true, user: candidateUser }, false);
    expect(screen.getByText("contenu-protégé")).toBeInTheDocument();
  });
});
