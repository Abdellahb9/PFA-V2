// Background function (up to 15 min): download CV -> extract text -> Groq
// structured extraction -> persist skills/education -> compute best-fit score.
// Invoked fire-and-forget by submit-application (and by /api/reanalyze).
import { admin, BUCKET } from "./_shared/supabase";
import { extractCvText, regexHints } from "./_shared/cv";
import { extractProfileCached } from "./_shared/cv-cache";
import { extractSkills } from "./_shared/skills";
import { getOrCreateSkill, loadOfferProfiles } from "./_shared/db";
import { compositeScore, type CandidateProfile } from "./_shared/scoring";

const ok = () => new Response(JSON.stringify({ status: "ok" }), { status: 200 });

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

export default async (req: Request): Promise<Response> => {
  const { application_id } = (await req.json().catch(() => ({}))) as { application_id?: number };
  if (!application_id) return new Response("missing application_id", { status: 400 });
  const sb = admin();

  try {
    await sb.from("applications").update({ status: "parsing" }).eq("id", application_id);

    const { data: app } = await sb
      .from("applications")
      .select("candidate_id")
      .eq("id", application_id)
      .single();
    if (!app) return ok();
    const candidateId = app.candidate_id as number;

    const { data: docs } = await sb
      .from("documents")
      .select("storage_path, filename")
      .eq("application_id", application_id);

    let fullText = "";
    for (const d of docs ?? []) {
      const { data: file } = await sb.storage.from(BUCKET).download(d.storage_path);
      if (file) {
        const buf = new Uint8Array(await file.arrayBuffer());
        fullText += "\n" + (await extractCvText(buf, d.filename));
      }
    }
    if (!fullText.trim()) {
      await sb.from("applications").update({ status: "failed" }).eq("id", application_id);
      return ok();
    }

    const llm = await extractProfileCached(fullText);
    const hints = regexHints(fullText);
    const skillsRaw = llm?.skills?.length ? llm.skills : extractSkills(fullText);

    await sb
      .from("candidates")
      .update({
        cv_text: fullText.slice(0, 20000),
        education_level: llm?.education_level ?? undefined,
        field_of_study: llm?.field_of_study ?? undefined,
        university: llm?.university ?? hints.university ?? undefined,
        years_experience: llm?.years_experience ?? hints.yearsExperience ?? 0,
        phone: llm?.phone ?? hints.phone ?? undefined,
      })
      .eq("id", candidateId);

    // Replace the candidate's skills with the freshly detected set.
    await sb.from("candidate_skills").delete().eq("candidate_id", candidateId);
    for (const s of skillsRaw) {
      const skillId = await getOrCreateSkill(s);
      await sb
        .from("candidate_skills")
        .upsert(
          { candidate_id: candidateId, skill_id: skillId, weight: 0.9 },
          { onConflict: "candidate_id,skill_id" },
        );
    }

    await sb
      .from("applications")
      .update({ status: "parsed", parsed_at: new Date().toISOString() })
      .eq("id", application_id);

    await computeBestScore(application_id, candidateId);
  } catch (err) {
    console.error("analyze failed:", err);
    await sb.from("applications").update({ status: "failed" }).eq("id", application_id);
  }
  return ok();
};
