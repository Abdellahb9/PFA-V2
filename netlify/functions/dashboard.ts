// GET /api/dashboard — KPIs + chart series (aggregated in JS over Supabase rows).
import { admin } from "./_shared/supabase";
import { requireStaff } from "./_shared/auth";
import { json, fail } from "./_shared/http";

const STATUS_FR: Record<string, string> = {
  submitted: "Soumise",
  parsing: "Analyse en cours",
  parsed: "Analysée",
  under_review: "En revue",
  assigned: "Affectée",
  rejected: "Rejetée",
  failed: "Échec",
};

export const config = { path: "/api/dashboard" };

const count = <T>(rows: T[], key: (r: T) => string | null) => {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) ?? "Non renseigné";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
};

export default async (req: Request): Promise<Response> => {
  const user = await requireStaff(req);
  if (user instanceof Response) return user;
  if (req.method !== "GET") return fail("Méthode non autorisée", 405);
  const sb = admin();

  // Fenêtre « nouveaux candidats » : 30 jours glissants.
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const since30d = since.toISOString();

  const [apps, offers, departments, assignments, candSkills, candCount, newCandCount] =
    await Promise.all([
    sb.from("applications").select("status, created_at, candidate:candidates(field_of_study)"),
    sb.from("internship_offers").select("slots"),
    sb.from("departments").select("id, name, capacity"),
    sb.from("assignments").select("match_score, status, offer:internship_offers(department_id)"),
    sb.from("candidate_skills").select("skill:skills(name)"),
    sb.from("candidates").select("id", { count: "exact", head: true }),
    // head:true -> on ne rapatrie que le compte, pas les lignes.
    sb
      .from("candidates")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since30d),
  ]);

  const appRows = (apps.data ?? []) as any[];
  const totalApplications = appRows.length;
  const totalCandidates = candCount.count ?? 0;
  const totalOffers = (offers.data ?? []).length;
  const totalSlots = (offers.data ?? []).reduce((s: number, o: any) => s + (o.slots ?? 0), 0);
  const assignedCount = appRows.filter((a) => a.status === "assigned").length;
  const pendingCount = appRows.filter((a) =>
    ["submitted", "parsed", "under_review"].includes(a.status),
  ).length;

  const assignRows = (assignments.data ?? []) as any[];
  const scored = assignRows.filter((a) => a.status !== "rejected");
  // Décisions du recruteur sur les propositions du moteur d'affectation.
  const confirmedCount = assignRows.filter((a) => a.status === "confirmed").length;
  const rejectedCount = assignRows.filter((a) => a.status === "rejected").length;
  const newCandidates30d = newCandCount.count ?? 0;
  const avgScore = scored.length
    ? scored.reduce((s, a) => s + Number(a.match_score ?? 0), 0) / scored.length
    : 0;

  // applications by status
  const byStatus = count(appRows, (a) => STATUS_FR[a.status] ?? a.status);
  // candidates by field (top 8)
  const byField = count(appRows, (a) => a.candidate?.field_of_study ?? null);
  // monthly
  const byMonth = count(appRows, (a) => (a.created_at ?? "").slice(0, 7));
  // top skills
  const bySkill = count((candSkills.data ?? []) as any[], (cs) => cs.skill?.name ?? null);
  // assignments by department
  const deptAssigned = new Map<number, number>();
  for (const a of scored) {
    const d = a.offer?.department_id;
    if (d != null) deptAssigned.set(d, (deptAssigned.get(d) ?? 0) + 1);
  }

  const round = (x: number) => Math.round(x * 1000) / 1000;
  const toSeries = (m: Map<string, number>, limit?: number) => {
    let arr = [...m.entries()].map(([label, value]) => ({ label, value }));
    arr.sort((a, b) => b.value - a.value);
    if (limit) arr = arr.slice(0, limit);
    return arr;
  };

  return json({
    kpis: {
      total_candidates: totalCandidates,
      total_applications: totalApplications,
      total_offers: totalOffers,
      total_slots: totalSlots,
      assigned_count: assignedCount,
      pending_count: pendingCount,
      confirmed_count: confirmedCount,
      rejected_count: rejectedCount,
      new_candidates_30d: newCandidates30d,
      assignment_rate: totalApplications ? round(assignedCount / totalApplications) : 0,
      capacity_fill_rate: totalSlots ? round(assignedCount / totalSlots) : 0,
      average_match_score: round(avgScore),
    },
    applications_by_status: toSeries(byStatus),
    candidates_by_field: toSeries(byField, 8),
    assignments_by_department: (departments.data ?? []).map((d: any) => {
      const assigned = deptAssigned.get(d.id) ?? 0;
      return {
        department: d.name,
        capacity: d.capacity,
        assigned,
        fill_rate: d.capacity ? round(assigned / d.capacity) : 0,
      };
    }),
    monthly_applications: [...byMonth.entries()]
      .filter(([m]) => m)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, value]) => ({ label, value })),
    top_skills: toSeries(bySkill, 10),
  });
};
