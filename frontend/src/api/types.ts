// Shared TypeScript types mirroring the backend Pydantic schemas.

export type UserRole = "admin" | "recruiter" | "viewer";

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface SkillRef {
  name: string;
  weight: number;
}

export interface Department {
  id: number;
  name: string;
  code: string;
  description?: string | null;
  supervisor_name?: string | null;
  supervisor_email?: string | null;
  capacity: number;
}

export type OfferStatus = "open" | "closed" | "draft";

export interface Offer {
  id: number;
  department_id: number;
  title: string;
  description?: string | null;
  field?: string | null;
  slots: number;
  min_education_level?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status: OfferStatus;
  skills: SkillRef[];
}

// Candidate portal: an applicant's own application + status timeline.
export interface MyApplicationEvent {
  status: ApplicationStatus;
  note?: string | null;
  created_at: string;
}
export interface MyApplication {
  id: number;
  status: ApplicationStatus;
  created_at: string;
  offer_title: string | null;
  department_name: string | null;
  events: MyApplicationEvent[];
}

// Public, read-only offer shown on the landing page (no auth).
export interface PublicOffer {
  id: number;
  title: string;
  field?: string | null;
  department_name?: string | null;
  slots: number;
  description?: string | null;
  skills: SkillRef[];
}

export interface Candidate {
  id: number;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  phone?: string | null;
  education_level?: string | null;
  field_of_study?: string | null;
  university?: string | null;
  years_experience: number;
  notes?: string | null;
  skills: SkillRef[];
  has_embedding: boolean;
}

// A candidate's application as shown on the CRM detail (fiche).
export interface CandidateApplicationRef {
  id: number;
  status: ApplicationStatus;
  match_score?: number | null;
  created_at: string;
  offer_title: string | null;
}

export interface CandidateDetail extends Candidate {
  applications: CandidateApplicationRef[];
}

// Admin user-management row (account + role + activity).
export interface AdminUser {
  id: string;
  email: string | null;
  full_name: string | null;
  role: "admin" | "recruiter" | "viewer" | "candidate";
  is_active: boolean;
  email_confirmed: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  candidate_id: number | null;
  application_count: number;
}

export type ApplicationStatus =
  | "submitted"
  | "parsing"
  | "parsed"
  | "under_review"
  | "assigned"
  | "rejected"
  | "failed";

// Minimal confirmation returned by the (public) application submission endpoint.
export interface ApplicationSubmitResult {
  id: number;
  status: ApplicationStatus;
  message: string;
}

export interface DocumentRef {
  id: number;
  kind: string;
  filename: string;
  content_type?: string | null;
  size: number;
}

export interface Application {
  id: number;
  candidate_id: number;
  offer_id?: number | null;
  status: ApplicationStatus;
  motivation?: string | null;
  match_score?: number | null;
  parsed_at?: string | null;
  created_at: string;
  candidate?: Candidate | null;
  documents?: DocumentRef[];
}

export interface ScoreBreakdown {
  skills: number;
  education: number;
  weights: { skills: number; education: number };
}

export interface RankedCandidate {
  application_id: number;
  candidate_id: number;
  candidate_name: string;
  match_score: number;
  score_breakdown: ScoreBreakdown;
}

export interface OfferRanking {
  offer_id: number;
  offer_title: string;
  department_name: string;
  slots: number;
  candidates: RankedCandidate[];
}

export interface AssignmentPreview {
  application_id: number;
  candidate_id: number;
  candidate_name: string;
  offer_id: number;
  offer_title: string;
  department_name: string;
  match_score: number;
  score_breakdown: ScoreBreakdown;
}

export interface MatchingResult {
  matching_run_id: number | null;
  algorithm: string;
  total_candidates: number;
  total_slots: number;
  assignments_count: number;
  total_score: number;
  average_score: number;
  persisted: boolean;
  assignments: AssignmentPreview[];
}

export interface LabelValue {
  label: string;
  value: number;
}

export interface DepartmentStat {
  department: string;
  capacity: number;
  assigned: number;
  fill_rate: number;
}

export interface KpiSummary {
  total_candidates: number;
  total_applications: number;
  total_offers: number;
  total_slots: number;
  assigned_count: number;
  pending_count: number;
  assignment_rate: number;
  capacity_fill_rate: number;
  average_match_score: number;
}

export interface DepartmentForecast {
  department_id: number;
  department: string;
  capacity: number;
  current_slots: number;
  total_applications_12m: number;
  monthly: number[];
  forecast_demand: number;
  recommended_slots: number;
  cold_start: boolean;
}

export interface CapacityForecast {
  target_pressure: number;
  cold_start_global: boolean;
  departments: DepartmentForecast[];
}

export interface DashboardData {
  kpis: KpiSummary;
  applications_by_status: LabelValue[];
  candidates_by_field: LabelValue[];
  assignments_by_department: DepartmentStat[];
  monthly_applications: LabelValue[];
  top_skills: LabelValue[];
}
