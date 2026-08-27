// React Query hooks wrapping the serverless API (Netlify Functions).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { submitApplicationViaStorage, submitApplicationsBulkViaStorage } from "./upload";
import { supabase, STORAGE_BUCKET } from "@/lib/supabase";
import type {
  AdminUser,
  AppNotification,
  Application,
  Booking,
  CapacityForecast,
  Candidate,
  CandidateDetail,
  DashboardData,
  Department,
  KnowledgeDocument,
  MatchingResult,
  MyApplication,
  MySwitchRequests,
  Offer,
  OfferSwitchRequest,
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

// Liste réduite pour la cloche de notifications. Clé distincte de celle de la
// page Candidats : le rafraîchissement périodique ne concerne que l en-tête.
export const useNewCandidates = () =>
  useQuery({
    queryKey: ["candidates-recent"],
    queryFn: async () => (await api.get<Candidate[]>("/candidates")).data,
    refetchInterval: 60_000,
    staleTime: 30_000,
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

// Décider sur une proposition du moteur d'affectation. La proposition n'existe
// pas forcément en base (mode aperçu), donc on l'identifie par le couple
// (candidature, offre) et le serveur crée puis décide en une fois.
export const useDecideProposal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      application_id: number;
      offer_id: number;
      status: "confirmed" | "rejected";
    }) => (await api.post("/assignments", body)).data,
    // Confirmer change l'occupation de l'offre : sans invalider le classement
    // par offre ni les affectations, ces écrans continuaient d'afficher le
    // candidat comme non confirmé jusqu'au rechargement complet de la page.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["assignments"] });
      qc.invalidateQueries({ queryKey: ["offer-rankings"] });
    },
  });
};

// Trancher une affectation DÉJÀ enregistrée, par son id.
//
// L'endpoint PATCH /assignments/:id existait sans aucun appelant : une
// proposition créée depuis le classement par offre n'apparaissait pas dans
// l'aperçu du moteur (état local, pas la base) et ne pouvait donc être
// confirmée nulle part dans l'interface.
export const useDecideAssignment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: "confirmed" | "rejected" }) =>
      (await api.patch(`/assignments/${id}`, { status })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["assignments"] });
      qc.invalidateQueries({ queryKey: ["offer-rankings"] });
    },
  });
};

// Manually assign a candidate (application) to a chosen offer.
export const useAssignCandidate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { application_id: number; offer_id: number }) =>
      (await api.post("/assignments", body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["assignments"] });
      qc.invalidateQueries({ queryKey: ["offer-rankings"] });
    },
  });
};

// ---- Assistant RAG ----
// Fils de conversation persistés (l'API ne renvoie que ceux de l'appelant).
export const useConversations = () =>
  useQuery({
    queryKey: ["assistant-conversations"],
    queryFn: async () =>
      (
        await api.get<{ id: number; title: string; updated_at: string }[]>(
          "/assistant/conversations",
        )
      ).data,
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
    // `replace` doit être explicite : un titre déjà pris renvoie 409 plutôt que
    // d'effacer en silence les extraits d'un autre document.
    mutationFn: async ({
      file,
      title,
      replace,
    }: {
      file: File;
      title?: string;
      replace?: boolean;
    }) => {
      const form = new FormData();
      form.append("file", file);
      if (title) form.append("title", title);
      if (replace) form.append("replace", "true");
      return (await api.post("/assistant/documents", form)).data;
    },
    // L'ingestion est synchrone : les extraits sont là dès la réponse.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge-documents"] }),
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

// ---- Échange d'offre ----
// Téléverse la preuve dans le bucket privé, puis dépose la demande. L'image ne
// transite pas par nos fonctions : URL signée -> upload direct -> chemin envoyé.
export const useCreateSwitchRequest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ requested_offer_id, file }: { requested_offer_id: number; file: File }) => {
      const { data: up } = await api.post<{ path: string; token: string }>(
        "/create-switch-proof-upload-url",
        { filename: file.name },
      );
      const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .uploadToSignedUrl(up.path, up.token, file);
      if (error) throw error;
      return (
        await api.post("/offer-switch-requests", {
          requested_offer_id,
          proof_image_path: up.path,
        })
      ).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-switch-requests"] }),
  });
};

export const useMySwitchRequests = () =>
  useQuery({
    queryKey: ["my-switch-requests"],
    queryFn: async () => (await api.get<MySwitchRequests>("/my-switch-requests")).data,
  });

// Vue personnel. `status` vaut "pending" | "approved" | "rejected" | "all".
export const useSwitchRequests = (status = "all") =>
  useQuery({
    queryKey: ["switch-requests", status],
    queryFn: async () =>
      (await api.get<OfferSwitchRequest[]>("/offer-switch-requests", { params: { status } })).data,
  });

// Compteur pour la pastille du menu : léger, rafraîchi périodiquement.
export const usePendingSwitchCount = (enabled: boolean) =>
  useQuery({
    queryKey: ["switch-requests", "pending"],
    queryFn: async () =>
      (await api.get<OfferSwitchRequest[]>("/offer-switch-requests", { params: { status: "pending" } }))
        .data.length,
    enabled,
    refetchInterval: 60_000,
  });

export const useReviewSwitchRequest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      action,
      admin_note,
    }: {
      id: string;
      action: "approve" | "reject";
      admin_note?: string;
    }) => (await api.post(`/offer-switch-requests/${id}/${action}`, { admin_note })).data,
    onSuccess: () => {
      // Une approbation déplace une affectation : les vues qui en dépendent
      // afficheraient sinon l'ancienne offre.
      qc.invalidateQueries({ queryKey: ["switch-requests"] });
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["offers"] });
    },
  });
};

// ---- Notifications ----
export const useNotifications = () =>
  useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await api.get<AppNotification[]>("/notifications")).data,
    refetchInterval: 60_000,
  });

export const useMarkNotificationRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await api.post(`/notifications/${id}/read`, {})).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
};
