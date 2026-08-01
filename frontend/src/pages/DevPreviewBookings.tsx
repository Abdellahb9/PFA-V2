// DEV-ONLY visual preview of the booking flow with mock data (no auth/backend).
// Mounted at /__preview/reservations by App.tsx only when import.meta.env.DEV.
// Renders the booked-offers page and the apply modal, the two surfaces the
// internship-period feature touches.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button, Space } from "antd";
import { useState } from "react";
import BookingsPage from "./BookingsPage";
import PublicApplicationModal from "@/components/PublicApplicationModal";
import ThemeToggle from "@/components/ThemeToggle";
import { api } from "@/api/client";
import type { Booking, PublicOffer } from "@/api/types";

const MOCK: Booking[] = [
  {
    assignment_id: 1,
    status: "confirmed",
    match_score: 0.91,
    decided_by: "admin@phosboucraa.ma",
    created_at: "2026-06-02T10:00:00Z",
    candidate_id: 11,
    person_name: "Youssef El Khattabi",
    person_email: "youssef@example.ma",
    offer_id: 3,
    offer_title: "Stage Big Data & Intelligence artificielle",
    department_name: "Direction des Systèmes d'Information",
    application_id: 21,
    start_date: "2026-07-01",
    end_date: "2026-10-01",
    duration_months: 3,
  },
  {
    assignment_id: 2,
    status: "confirmed",
    match_score: 0.84,
    decided_by: "admin@phosboucraa.ma",
    created_at: "2026-06-04T10:00:00Z",
    candidate_id: 12,
    person_name: "Salma Benjelloun",
    person_email: "salma@example.ma",
    offer_id: 5,
    offer_title: "Stage Data Science",
    department_name: "Direction des Systèmes d'Information",
    application_id: 22,
    start_date: "2026-07-15",
    end_date: "2027-01-15",
    duration_months: 6,
  },
  {
    assignment_id: 3,
    status: "confirmed",
    match_score: 0.79,
    decided_by: "admin@phosboucraa.ma",
    created_at: "2026-06-09T10:00:00Z",
    candidate_id: 13,
    person_name: "Omar Fassi",
    person_email: "omar@example.ma",
    offer_id: 8,
    offer_title: "Stage Automatisme & GMAO",
    department_name: "Maintenance Industrielle",
    application_id: 23,
    start_date: "2026-09-01",
    end_date: "2027-01-01",
    duration_months: 4,
  },
  {
    assignment_id: 4,
    status: "confirmed",
    match_score: 0.72,
    decided_by: "admin@phosboucraa.ma",
    created_at: "2026-05-20T10:00:00Z",
    candidate_id: 14,
    person_name: "Imane Cherkaoui",
    person_email: "imane@example.ma",
    offer_id: 9,
    offer_title: "Stage Système Qualité ISO 9001",
    department_name: "Qualité, Hygiène, Sécurité & Environnement",
    application_id: 24,
    start_date: null,
    end_date: null,
    duration_months: null,
  },
];

const MOCK_OFFER: PublicOffer = {
  id: 3,
  title: "Stage Big Data & Intelligence artificielle",
  description: "Concevoir des analyses exploratoires et réaliser des visualisations.",
  field: "Informatique",
  slots: 1,
  department_name: "Direction des Systèmes d'Information",
  skills: [{ name: "python" }, { name: "sql" }],
} as PublicOffer;

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

// Serve /bookings from the mock instead of the (absent) local API, so the page
// exercises its real hook, query keys and filter params. Dev preview only.
api.interceptors.request.use((cfg) => {
  if (cfg.url?.startsWith("/bookings")) {
    const p = (cfg.params ?? {}) as { status?: string; from?: string; to?: string };
    cfg.adapter = async () => {
      const rows = MOCK.filter((b) => {
        if (p.status && p.status !== "all" && b.status !== p.status) return false;
        if (!b.start_date || !b.end_date) return !p.from && !p.to;
        if (p.from && b.end_date < p.from) return false;
        if (p.to && b.start_date > p.to) return false;
        return true;
      });
      return { data: rows, status: 200, statusText: "OK", headers: {}, config: cfg };
    };
  }
  return cfg;
});

export default function DevPreviewBookings() {
  const [applyOpen, setApplyOpen] = useState(false);
  return (
    <QueryClientProvider client={client}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: 24 }}>
        <Space style={{ width: "100%", justifyContent: "flex-end", marginBottom: 8 }}>
          <Button onClick={() => setApplyOpen(true)}>Ouvrir « Postuler »</Button>
          <ThemeToggle />
        </Space>
        <BookingsPage />
        <PublicApplicationModal
          open={applyOpen}
          offer={MOCK_OFFER}
          onClose={() => setApplyOpen(false)}
        />
      </div>
    </QueryClientProvider>
  );
}
