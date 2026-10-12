// Cache the Groq CV-extraction result in Supabase, keyed by SHA-256 of the
// normalized CV text. On a hit we skip the Groq call entirely. Fail-open: any
// cache error falls back to a fresh extraction (never blocks analysis).
import { createHash } from "node:crypto";
import { admin } from "./supabase";
import { extractProfile, type ExtractedProfile } from "./groq";

// Entries older than this are treated as stale (configurable).
const TTL_DAYS = Number(process.env.CV_CACHE_TTL_DAYS ?? 30);

export function hashText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

export async function extractProfileCached(cvText: string): Promise<ExtractedProfile | null> {
  if (!cvText || !cvText.trim()) return null;
  const sb = admin();
  const hash = hashText(cvText);

  // 1) Lookup (fail-open).
  try {
    const since = new Date(Date.now() - TTL_DAYS * 86_400_000).toISOString();
    const { data } = await sb
      .from("cv_analysis_cache")
      .select("profile")
      .eq("text_hash", hash)
      .gte("created_at", since)
      .maybeSingle();
    if (data?.profile) return data.profile as ExtractedProfile;
  } catch (err) {
    console.warn("cv_analysis_cache read failed (recomputing):", err);
  }

  // 2) Miss → call Groq.
  const profile = await extractProfile(cvText);

  // 3) Store successful extractions (fail-open); upsert refreshes the TTL.
  if (profile) {
    try {
      await sb
        .from("cv_analysis_cache")
        .upsert(
          { text_hash: hash, profile, created_at: new Date().toISOString() },
          { onConflict: "text_hash" },
        );
    } catch (err) {
      console.warn("cv_analysis_cache write failed:", err);
    }
  }
  return profile;
}
