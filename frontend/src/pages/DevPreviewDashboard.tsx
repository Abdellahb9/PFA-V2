// DEV-ONLY visual preview of the dashboard with mock data (no auth/backend).
// Mounted at /__preview/dashboard by App.tsx only when import.meta.env.DEV.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DashboardPage from "./DashboardPage";
import ThemeToggle from "@/components/ThemeToggle";
import type { DashboardData } from "@/api/types";

const MOCK: DashboardData = {
  kpis: {
    total_candidates: 248,
    total_applications: 512,
    total_offers: 36,
    total_slots: 125,
    assigned_count: 88,
    pending_count: 184,
    assignment_rate: 0.68,
    average_match_score: 0.74,
    capacity_fill_rate: 0.7,
  },
  applications_by_status: [
    { label: "Soumise", value: 96 },
    { label: "Analysée", value: 174 },
    { label: "En revue", value: 88 },
    { label: "Affectée", value: 118 },
    { label: "Rejetée", value: 36 },
  ],
  candidates_by_field: [
    { label: "Informatique", value: 74 },
    { label: "Électromécanique", value: 52 },
    { label: "Chimie industrielle", value: 41 },
    { label: "Génie civil", value: 33 },
    { label: "Logistique", value: 27 },
    { label: "Finance", value: 21 },
  ],
  assignments_by_department: [
    { department: "Production", capacity: 40, assigned: 34, fill_rate: 0.85 },
    { department: "Maintenance", capacity: 30, assigned: 19, fill_rate: 0.63 },
    { department: "Laboratoire", capacity: 18, assigned: 6, fill_rate: 0.33 },
    { department: "Logistique", capacity: 22, assigned: 17, fill_rate: 0.77 },
    { department: "IT", capacity: 15, assigned: 12, fill_rate: 0.8 },
  ],
  monthly_applications: [
    { label: "Fév", value: 22 },
    { label: "Mars", value: 38 },
    { label: "Avr", value: 31 },
    { label: "Mai", value: 55 },
    { label: "Juin", value: 74 },
    { label: "Juil", value: 92 },
  ],
  top_skills: [
    { label: "Python", value: 84 },
    { label: "Excel", value: 71 },
    { label: "SQL", value: 63 },
    { label: "AutoCAD", value: 44 },
    { label: "Maintenance ind.", value: 39 },
    { label: "Gestion de projet", value: 31 },
  ],
};

// Seeded client so useDashboard()/useCapacityForecast() resolve instantly.
const client = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false } },
});
client.setQueryData(["dashboard"], MOCK);
client.setQueryData(["capacity-forecast"], {
  model: "xgboost",
  target_pressure: 0.8,
  cold_start_global: false,
  departments: [
    {
      department_id: 1,
      department: "Production",
      total_applications_12m: 210,
      forecast_demand: 24,
      current_slots: 40,
      recommended_slots: 44,
      cold_start: false,
    },
    {
      department_id: 2,
      department: "Maintenance",
      total_applications_12m: 122,
      forecast_demand: 12,
      current_slots: 30,
      recommended_slots: 27,
      cold_start: false,
    },
    {
      department_id: 3,
      department: "Laboratoire",
      total_applications_12m: 9,
      forecast_demand: 0,
      current_slots: 18,
      recommended_slots: 18,
      cold_start: true,
    },
  ],
});

export default function DevPreviewDashboard() {
  return (
    <QueryClientProvider client={client}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <ThemeToggle />
        </div>
        <DashboardPage />
      </div>
    </QueryClientProvider>
  );
}
