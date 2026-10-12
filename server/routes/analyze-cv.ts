// Tâche de fond : analyse du CV d'une candidature (lib/cv-pipeline.ts) —
// extraction, profil, candidat à jour, CV indexé pour l'assistant, score.
// Déclenchée sans attente par submit-application(-bulk), la réanalyse, le
// dépôt d'un CV depuis l'assistant et la réindexation.
import { analyzeApplication } from "../lib/cv-pipeline";
import { rejectUnlessInternal } from "../lib/internal-auth";

export default async (req: Request): Promise<Response> => {
  const denied = rejectUnlessInternal(req);
  if (denied) return denied;
  const { application_id } = (await req.json().catch(() => ({}))) as { application_id?: number };
  if (!application_id) return new Response("missing application_id", { status: 400 });
  const status = await analyzeApplication(Number(application_id));
  return new Response(JSON.stringify({ status }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
