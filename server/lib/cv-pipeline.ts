// Chaîne CV unique.
//
//   candidature → texte page par page → extraction structurée (Groq, en cache)
//   → candidat mis à jour (identité, formation, compétences, profil détaillé)
//   → CV indexé et RATTACHÉ au candidat → vecteurs → meilleur score.
//
// Tout CV passe par ici : candidature du portail, import en masse, dépôt depuis
// l'assistant, réindexation. L'assistant voit donc chaque CV, et sait à qui il
// appartient — avant, les CV des candidatures n'atteignaient jamais sa base.
import { randomUUID } from "node:crypto";
import { admin, BUCKET } from "./supabase";
import { reconcileExperience, regexHints } from "./cv";
import { extractProfileCached } from "./cv-cache";
import { extractSkills } from "./skills";
import { getOrCreateSkill, loadOfferProfiles } from "./db";
import { compositeScore, type CandidateProfile } from "./scoring";
import {
  cvDocumentName,
  cvTitle,
  embeddingsEnabled,
  embedPending,
  extractDocument,
  ingestPages,
  type PageText,
} from "./rag";

/**
 * Les candidatures importées portent une identité provisoire (e-mail sur ce
 * domaine, nom deviné du fichier) : l'analyse la remplace par celle du CV.
 */
export const PLACEHOLDER_EMAIL_DOMAIN = "cv-import.local";

/** Texte minimal pour qu'un cv_text sans fichier vaille la peine d'être indexé. */
const MIN_INDEXABLE_CV_TEXT = 80;

/** Extraits vectorisés juste après l'analyse ; le reste attend la tâche de fond. */
const INLINE_EMBED_LIMIT = 400;

// "jean_dupont_CV.pdf" -> { first: "Jean", last: "Dupont" }
export function guessNameFromFilename(filename: string): { first: string; last: string } {
  const base = filename.replace(/\.(pdf|docx|txt|md)$/i, "");
  const words = base
    .split(/[_\-.\s]+/)
    .filter((w) => w && !/^(cv|resume|curriculum|vitae|\d+)$/i.test(w))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return {
    first: words[0] ?? "Candidat",
    last: words.slice(1).join(" ") || "(import CV)",
  };
}

/**
 * Crée un candidat provisoire et sa candidature pour un CV déjà déposé dans le
 * Storage. `offerId` nul : candidature spontanée (vivier). L'analyse remplacera
 * l'identité, ou rattachera la candidature à un candidat existant (même e-mail).
 */
export async function createCvApplication(input: {
  filename: string;
  storagePath: string;
  contentType?: string | null;
  size?: number | null;
  offerId?: number | null;
}): Promise<{ applicationId: number; candidateId: number }> {
  const sb = admin();
  const name = guessNameFromFilename(input.filename);
  const { data: cand, error: candErr } = await sb
    .from("candidates")
    .insert({
      first_name: name.first,
      last_name: name.last,
      email: `import-${randomUUID()}@${PLACEHOLDER_EMAIL_DOMAIN}`,
    })
    .select("id")
    .single();
  if (candErr || !cand) throw new Error(candErr?.message ?? "Création du candidat impossible");

  const { data: app, error: appErr } = await sb
    .from("applications")
    .insert({ candidate_id: cand.id, offer_id: input.offerId ?? null, status: "submitted" })
    .select("id")
    .single();
  if (appErr || !app) {
    await sb.from("candidates").delete().eq("id", cand.id);
    throw new Error(appErr?.message ?? "Création de la candidature impossible");
  }

  await sb.from("documents").insert({
    application_id: app.id,
    kind: "cv",
    filename: input.filename,
    storage_path: input.storagePath,
    content_type: input.contentType ?? null,
    size: input.size ?? 0,
  });
  return { applicationId: app.id as number, candidateId: cand.id as number };
}

/**
 * Indexe le CV d'un candidat dans la base de connaissances, sous son nom :
 * chaque extrait porte « Prénom Nom › Section ». Un seul CV par candidat,
 * remplacé à chaque analyse. Renvoie le nombre d'extraits.
 */
export async function indexCandidateCv(candidateId: number, pages: PageText[]): Promise<number> {
  const { data: c } = await admin()
    .from("candidates")
    .select("first_name, last_name")
    .eq("id", candidateId)
    .single();
  const name = `${c?.first_name ?? ""} ${c?.last_name ?? ""}`.trim() || `Candidat #${candidateId}`;
  const res = await ingestPages(cvDocumentName(candidateId), pages, "cv", true, {
    candidateId,
    title: cvTitle(name),
    headingTitle: name,
  });
  if (embeddingsEnabled()) {
    // Un CV fait une poignée d'extraits : on les vectorise tout de suite. En cas
    // d'échec, la tâche de fond quotidienne (/api/rag-embed) rattrapera.
    try {
      await embedPending(INLINE_EMBED_LIMIT);
    } catch (err) {
      console.warn("[cv] vectorisation différée :", err);
    }
  }
  return res.chunks;
}

async function computeBestScore(applicationId: number, candidateId: number) {
  const sb = admin();
  const { data: cand } = await sb
    .from("candidates")
    .select("first_name, last_name, education_level, candidate_skills(weight, skill:skills(normalized))")
    .eq("id", candidateId)
    .single();
  if (!cand) return;
  const skills = new Map<string, number>();
  for (const cs of (cand as any).candidate_skills ?? []) {
    if (cs.skill?.normalized) skills.set(cs.skill.normalized, cs.weight);
  }
  const profile: CandidateProfile = {
    candidateId,
    applicationId,
    name: `${cand.first_name} ${cand.last_name}`,
    skills,
    educationLevel: cand.education_level ?? null,
  };
  const offers = await loadOfferProfiles();
  if (!offers.length) return;
  const best = Math.max(...offers.map((o) => compositeScore(profile, o).score));
  await sb.from("applications").update({ match_score: best }).eq("id", applicationId);
}

/** Analyse complète d'une candidature. Ne lève pas : l'échec est consigné en base. */
export async function analyzeApplication(applicationId: number): Promise<"parsed" | "failed" | "missing"> {
  const sb = admin();
  try {
    const { data: app } = await sb
      .from("applications")
      .select("candidate_id")
      .eq("id", applicationId)
      .maybeSingle();
    if (!app) return "missing";
    await sb.from("applications").update({ status: "parsing" }).eq("id", applicationId);
    let candidateId = app.candidate_id as number;

    const { data: docs } = await sb
      .from("documents")
      .select("storage_path, filename")
      .eq("application_id", applicationId);

    // Page par page : la page suit chaque extrait jusqu'à la citation (« p. 2 »).
    const pages: PageText[] = [];
    for (const d of docs ?? []) {
      const { data: file } = await sb.storage.from(BUCKET).download(d.storage_path);
      if (file) pages.push(...(await extractDocument(new Uint8Array(await file.arrayBuffer()), d.filename)));
    }
    const fullText = pages.map((p) => p.text).join("\n\n");
    if (!fullText.trim()) {
      await sb.from("applications").update({ status: "failed" }).eq("id", applicationId);
      return "failed";
    }

    const llm = await extractProfileCached(fullText);
    const hints = regexHints(fullText);
    const skillsRaw = llm?.skills?.length ? llm.skills : extractSkills(fullText);

    // Identité provisoire (import en masse, dépôt depuis l'assistant) : on la
    // remplace par celle du CV — ou, si l'e-mail existe déjà, on rattache la
    // candidature au candidat existant au lieu de créer un doublon.
    const { data: candRow } = await sb.from("candidates").select("email").eq("id", candidateId).single();
    if (candRow?.email?.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`)) {
      const email = llm?.email ?? hints.email;
      if (email) {
        const { data: existing } = await sb
          .from("candidates")
          .select("id")
          .eq("email", email)
          .neq("id", candidateId)
          .maybeSingle();
        if (existing) {
          await sb.from("applications").update({ candidate_id: existing.id }).eq("id", applicationId);
          await sb.from("candidate_skills").delete().eq("candidate_id", candidateId);
          await sb.from("candidates").delete().eq("id", candidateId);
          candidateId = existing.id;
        } else {
          await sb
            .from("candidates")
            .update({ email, first_name: llm?.first_name ?? undefined, last_name: llm?.last_name ?? undefined })
            .eq("id", candidateId);
        }
      } else if (llm?.first_name || llm?.last_name) {
        await sb
          .from("candidates")
          .update({ first_name: llm?.first_name ?? undefined, last_name: llm?.last_name ?? undefined })
          .eq("id", candidateId);
      }
    }

    await sb
      .from("candidates")
      .update({
        cv_text: fullText.slice(0, 20000),
        education_level: llm?.education_level ?? undefined,
        field_of_study: llm?.field_of_study ?? undefined,
        university: llm?.university ?? hints.university ?? undefined,
        // Le modèle prend régulièrement l'âge pour de l'expérience : on arbitre
        // au lieu de lui faire confiance aveuglément.
        years_experience: reconcileExperience(llm?.years_experience, hints.yearsExperience),
        phone: llm?.phone ?? hints.phone ?? undefined,
        ...(llm?.profile ? { profile: llm.profile, profile_updated_at: new Date().toISOString() } : {}),
      })
      .eq("id", candidateId);

    // Les compétences du candidat sont remplacées par celles du CV.
    await sb.from("candidate_skills").delete().eq("candidate_id", candidateId);
    for (const s of skillsRaw) {
      const skillId = await getOrCreateSkill(s);
      await sb
        .from("candidate_skills")
        .upsert({ candidate_id: candidateId, skill_id: skillId, weight: 0.9 }, { onConflict: "candidate_id,skill_id" });
    }

    // Après la mise à jour de l'identité : le CV est indexé sous le bon nom.
    await indexCandidateCv(candidateId, pages);

    await sb
      .from("applications")
      .update({ status: "parsed", parsed_at: new Date().toISOString() })
      .eq("id", applicationId);
    await computeBestScore(applicationId, candidateId);
    return "parsed";
  } catch (err) {
    console.error("analyze failed:", err);
    await sb.from("applications").update({ status: "failed" }).eq("id", applicationId);
    return "failed";
  }
}

/**
 * Remet la base de connaissances en phase avec les candidats : pour chacun, sa
 * dernière candidature munie d'un CV est réanalysée (`analyze`) ; à défaut de
 * fichier, le texte déjà connu (cv_text) est indexé tel quel.
 */
export async function reindexAll(
  analyze: (applicationId: number) => Promise<unknown> | void,
): Promise<{ analyses: number; indexes_sans_fichier: number; ignores: number }> {
  const sb = admin();
  const { data: cands, error } = await sb
    .from("candidates")
    .select("id, cv_text, applications(id, created_at, documents(id))")
    .order("id");
  if (error) throw new Error(error.message);

  const out = { analyses: 0, indexes_sans_fichier: 0, ignores: 0 };
  for (const c of (cands ?? []) as {
    id: number;
    cv_text: string | null;
    applications: { id: number; created_at: string; documents: { id: number }[] }[];
  }[]) {
    const withFile = (c.applications ?? [])
      .filter((a) => (a.documents ?? []).length > 0)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (withFile) {
      await analyze(withFile.id);
      out.analyses++;
    } else if ((c.cv_text ?? "").trim().length >= MIN_INDEXABLE_CV_TEXT) {
      await indexCandidateCv(c.id, [{ page: null, text: c.cv_text! }]);
      out.indexes_sans_fichier++;
    } else {
      out.ignores++;
    }
  }
  return out;
}
