// React Query hooks wrapping the serverless API (Netlify Functions).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { submitApplicationViaStorage } from "./upload";
import type {
  Application,
  Candidate,
  DashboardData,
  Department,
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
    },
  });
};

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
