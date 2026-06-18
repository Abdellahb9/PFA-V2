// React Query hooks wrapping the backend REST API.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type {
  Application,
  ApplicationSubmitResult,
  Candidate,
  DashboardData,
  Department,
  MatchingResult,
  Offer,
  PublicOffer,
} from "./types";

// ---- Public (no auth) ----
export const usePublicOffers = () =>
  useQuery({
    queryKey: ["public-offers"],
    queryFn: async () => (await api.get<PublicOffer[]>("/public/offers")).data,
  });

// Public application submission (landing page). No auth, no admin-query invalidation.
export const useSubmitPublicApplication = () =>
  useMutation({
    mutationFn: async (form: FormData) =>
      (
        await api.post<ApplicationSubmitResult>("/applications", form, {
          headers: { "Content-Type": "multipart/form-data" },
        })
      ).data,
  });

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
    // Poll while any application is still being parsed so the UI updates live.
    refetchInterval: (query) => {
      const data = query.state.data as Application[] | undefined;
      const inProgress = data?.some((a) =>
        ["submitted", "parsing"].includes(a.status)
      );
      return inProgress ? 3000 : false;
    },
  });

// Submit a new application with a CV (and optional cover letter) as multipart.
export const useSubmitApplication = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: FormData) =>
      (
        await api.post<ApplicationSubmitResult>("/applications", form, {
          headers: { "Content-Type": "multipart/form-data" },
        })
      ).data,
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

// Fetch a stored document as a blob (auth header required) and open it in a tab.
export const openDocument = async (
  applicationId: number,
  documentId: number
): Promise<void> => {
  const res = await api.get(
    `/applications/${applicationId}/documents/${documentId}/download`,
    { responseType: "blob" }
  );
  const url = URL.createObjectURL(res.data as Blob);
  window.open(url, "_blank");
  // Revoke shortly after to give the new tab time to load.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

// ---- Matching ----
export const useRunMatching = () =>
  useMutation({
    mutationFn: async (body: {
      weights: { semantic: number; skills: number; education: number };
      persist: boolean;
      min_score: number;
    }) => (await api.post<MatchingResult>("/matching/run", body)).data,
  });

export const useDecideAssignment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) =>
      (await api.patch(`/matching/assignments/${id}`, null, { params: { status } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["applications"] });
    },
  });
};
