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
  /** Requested internship period (end_date is derived from the duration). */
  start_date: string | null;
  end_date: string | null;
  duration_months: number | null;
  events: MyApplicationEvent[];
}

// A booked offer slot: a confirmed (or proposed) assignment placed on the
// calendar by the period the candidate requested when applying.
export interface Booking {
  assignment_id: number;
  status: "proposed" | "confirmed" | "rejected";
  match_score: number | null;
  decided_by: string | null;
  created_at: string;
  candidate_id: number | null;
  person_name: string;
  person_email: string | null;
  offer_id: number | null;
  offer_title: string;
  department_name: string | null;
  application_id: number | null;
  start_date: string | null;
  end_date: string | null;
  duration_months: number | null;
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
  /** Date d arrivée du candidat — sert aux notifications. */
  created_at?: string | null;
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
  /** Affectations tranchées par un recruteur. */
  confirmed_count: number;
  rejected_count: number;
  /** Candidats enregistrés sur les 30 derniers jours. */
  new_candidates_30d: number;
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
  model?: string; // "xgboost" | "fallback" (FastAPI backend) — optional
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

// ---- Assistant RAG ----
// `similarity` est un score ABSOLU (ts_rank_cd, dans [0, 1[) renvoyé par
// Postgres : il se compare d'une requête à l'autre. Il n'est plus normalisé sur
// le meilleur résultat, ce qui affichait « 100 % » sur le premier extrait même
// lorsqu'il était hors sujet.
export interface AssistantCandidateSource {
  type: "candidate";
  candidate_id: number;
  name: string;
  education_level: string | null;
  field_of_study: string | null;
  years_experience: number;
  skills: string[];
  similarity: number;
}

export interface AssistantChunkSource {
  type: "doc_chunk";
  source_document: string;
  chunk_index: number;
  text: string;
  similarity: number;
}

export interface AssistantExplanationSource {
  type: "matching_explanation";
  assignment_id: number;
  match_score: number;
  score_breakdown: Record<string, unknown> | null;
  status: string;
  candidate: {
    name: string;
    education_level: string | null;
    field_of_study: string | null;
    years_experience: number;
    skills: string[];
  };
  offer: {
    title: string;
    min_education_level: string | null;
    required_skills: string[];
  };
}

export type AssistantSource =
  | AssistantCandidateSource
  | AssistantChunkSource
  | AssistantExplanationSource;

export interface KnowledgeDocument {
  source_document: string;
  chunks: number;
}

// ---- Échange d'offre ----
export type SwitchRequestStatus = "pending" | "approved" | "rejected";

/** Vue candidat : uniquement ses propres demandes. */
export interface MySwitchRequest {
  id: string;
  status: SwitchRequestStatus;
  admin_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  current_offer_title: string;
  requested_offer_title: string;
}

export interface MySwitchRequests {
  placement: { applicationId: number; offerId: number; offerTitle: string } | null;
  requests: MySwitchRequest[];
}

/** Vue personnel : identité du candidat + URL signée de la preuve. */
export interface OfferSwitchRequest {
  id: string;
  status: SwitchRequestStatus;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  candidate_id: number | null;
  candidate_name: string;
  candidate_email: string | null;
  current_offer_id: number | null;
  current_offer_title: string;
  requested_offer_id: number | null;
  requested_offer_title: string;
  proof_url: string | null;
}

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  created_at: string;
}
