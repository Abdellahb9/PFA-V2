// React Query hooks wrapping the serverless API (Netlify Functions).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { submitApplicationViaStorage, submitApplicationsBulkViaStorage } from "./upload";
import type {
  AdminUser,
  Application,
  AssistantResponse,
  Booking,
  CapacityForecast,
  Candidate,
  CandidateDetail,
  DashboardData,
  Department,
  KnowledgeDocument,
  MatchingResult,
  MyApplication,
  Offer,
  OfferRanking,
  PublicOffer,
} from "./types";

// ---- Candidate portal ----
export const useMyApplications = () =>
  useQuery({
    queryKey: ["my-applications"],
    queryFn: async () => (await api.get<MyApplication[]>("/my-applications")).data,
    // Poll so the candidate sees admin status changes live.
    refetchInterval: (query) => {
      const data = query.state.data as MyApplication[] | undefined;
      const inProgress = data?.some((a) => ["submitted", "parsing"].includes(a.status));
      return inProgress ? 5000 : 20000;
    },
  });

// ---- Public (no auth) ----
export const usePublicOffers = () =>
  useQuery({
    queryKey: ["public-offers"],
    queryFn: async () => (await api.get<PublicOffer[]>("/public-offers")).data,
  });

export const useSubmitPublicApplication = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fields, file }: { fields: Record<string, unknown>; file: File }) =>
      submitApplicationViaStorage(fields, file),
    // Refresh the candidate's own list if they applied while signed in.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-applications"] }),
  });
};

// ---- Dashboard ----
export const useDashboard = () =>
  useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await api.get<DashboardData>("/dashboard")).data,
    refetchInterval: 30_000,
  });

export const useCapacityForecast = () =>
  useQuery({
    queryKey: ["capacity-forecast"],
    queryFn: async () => (await api.get<CapacityForecast>("/capacity-forecast")).data,
  });

// ---- Departments ----
export const useDepartments = () =>
  useQuery({
    queryKey: ["departments"],
    queryFn: async () => (await api.get<Department[]>("/departments")).data,
  });

export const useCreateDepartment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<Department>) =>
      (await api.post<Department>("/departments", body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["departments"] }),
  });
};

export const useUpdateDepartment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Partial<Department> }) =>
      (await api.patch<Department>(`/departments/${id}`, body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
};

export const useDeleteDepartment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => api.delete(`/departments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
};

// ---- Offers ----
export const useOffers = () =>
  useQuery({
    queryKey: ["offers"],
    queryFn: async () => (await api.get<Offer[]>("/offers")).data,
  });

export const useCreateOffer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post<Offer>("/offers", body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["offers"] }),
  });
};

export const useDeleteOffer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => api.delete(`/offers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["offers"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
};

// ---- Candidates ----
export const useCandidates = (search?: string) =>
  useQuery({
    queryKey: ["candidates", search],
    queryFn: async () =>
      (await api.get<Candidate[]>("/candidates", { params: { search } })).data,
  });

// CRM detail (fiche): candidate + applications + notes.
export const useCandidate = (id: number | null) =>
  useQuery({
    queryKey: ["candidate", id],
    queryFn: async () => (await api.get<CandidateDetail>(`/candidates/${id}`)).data,
    enabled: id != null,
  });

export const useUpdateCandidateNotes = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, notes }: { id: number; notes: string }) =>
      (await api.patch<CandidateDetail>(`/candidates/${id}`, { notes })).data,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["candidate", data.id] });
      qc.invalidateQueries({ queryKey: ["candidates"] });
    },
  });
};

// ---- Users (admin only) ----
export const useUsers = () =>
  useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get<AdminUser[]>("/users")).data,
  });

export const useCreateUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      email: string;
      password: string;
      full_name: string;
      role: string;
    }) => (await api.post("/users", body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
};

export const useUpdateUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: { role?: string; is_active?: boolean };
    }) => (await api.patch(`/users/${id}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
};

// ---- Applications ----
export const useApplications = (status?: string) =>
  useQuery({
    queryKey: ["applications", status],
    queryFn: async () =>
      (await api.get<Application[]>("/applications", { params: { status } })).data,
    refetchInterval: (query) => {
      const data = query.state.data as Application[] | undefined;
      const inProgress = data?.some((a) => ["submitted", "parsing"].includes(a.status));
      return inProgress ? 4000 : false;
    },
  });

export const useSubmitApplication = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fields, file }: { fields: Record<string, unknown>; file: File }) =>
      submitApplicationViaStorage(fields, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["candidates"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
};

// Bulk CV import: one application per file, identity filled by the CV analysis.
export const useBulkSubmitApplications = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      files,
      offerId,
      onProgress,
    }: {
      files: File[];
      offerId?: number | null;
      onProgress?: (done: number, total: number) => void;
    }) => submitApplicationsBulkViaStorage(files, offerId, onProgress),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["candidates"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
};

export const useDeleteApplication = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => api.delete(`/applications/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["candidates"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
};

// Open the stored CV in a new tab via a short-lived signed URL.
export const openDocument = async (applicationId: number): Promise<void> => {
  const { data } = await api.get<{ url: string }>(`/applications/${applicationId}/cv-url`);
  window.open(data.url, "_blank");
};

// ---- Matching ----
export const useRunMatching = () =>
  useMutation({
    mutationFn: async (body: {
      weights: { skills: number; education: number };
      persist: boolean;
      min_score: number;
    }) => (await api.post<MatchingResult>("/matching-run", body)).data,
  });

export const useDecideAssignment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) =>
      (await api.patch(`/assignments/${id}`, { status })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["applications"] });
      // A decision creates/removes a booking.
      qc.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
};

// ---- Booked offers ----
// `from`/`to` keep the bookings that OVERLAP the window, not just those
// starting inside it, so a running internship shows up in the month you ask for.
export const useBookings = (params: {
  status?: string;
  from?: string;
  to?: string;
  include_undated?: boolean;
}) =>
  useQuery({
    queryKey: ["bookings", params],
    queryFn: async () =>
      (
        await api.get<Booking[]>("/bookings", {
          params: {
            status: params.status,
            from: params.from,
            to: params.to,
            include_undated: params.include_undated ? 1 : undefined,
          },
        })
      ).data,
  });

// Per-offer ranking of all compatible candidates (fetched on demand).
export const useOfferRankings = (
  weights: { skills: number; education: number },
  enabled: boolean,
) =>
  useQuery({
    queryKey: ["offer-rankings", weights],
    queryFn: async () =>
      (await api.get<OfferRanking[]>("/offer-rankings", { params: weights })).data,
    enabled,
  });

// Manually assign a candidate (application) to a chosen offer.
export const useAssignCandidate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { application_id: number; offer_id: number }) =>
      (await api.post("/assignments", body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
};

// ---- Assistant RAG ----
export const useAssistantQuery = () =>
  useMutation({
    mutationFn: async (body: {
      query: string;
      assignment_id?: number;
      min_years_experience?: number;
      education_level?: string;
      top_k?: number;
    }) => (await api.post<AssistantResponse>("/assistant/query", body)).data,
  });

export const useKnowledgeDocuments = () =>
  useQuery({
    queryKey: ["knowledge-documents"],
    queryFn: async () => (await api.get<KnowledgeDocument[]>("/assistant/documents")).data,
  });

// Upload a policy/process document; ingestion (chunk + embed) runs async in Celery.
export const useIngestKnowledgeDocument = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, title }: { file: File; title?: string }) => {
      const form = new FormData();
      form.append("file", file);
      if (title) form.append("title", title);
      return (await api.post("/assistant/documents", form)).data;
    },
    // Chunks appear once the Celery task finishes; refresh after a short delay too.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["knowledge-documents"] });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["knowledge-documents"] }), 8000);
    },
  });
};

export const useDeleteKnowledgeDocument = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sourceDocument: string) =>
      (await api.delete(`/assistant/documents/${encodeURIComponent(sourceDocument)}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge-documents"] }),
  });
};
