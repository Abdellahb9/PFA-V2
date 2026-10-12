// Remet la base de connaissances de l'assistant en phase avec les candidats,
// contre la base désignée par .env (SUPABASE_URL…) :
//
//   npm run reindex
//
// Pour chaque candidat : son dernier CV stocké est réanalysé (profil, CV indexé
// sous son nom, vecteurs si MISTRAL_API_KEY), ou, sans fichier, son texte de CV
// connu est indexé tel quel. Mêmes règles que le bouton « Réindexer » de la page
// Assistant (POST /api/assistant/reindex), mais les analyses tournent ici l'une
// après l'autre, sans tâche de fond.
import { analyzeApplication, reindexAll } from "../lib/cv-pipeline";

async function main() {
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Variables manquantes : ${missing.join(", ")}`);
    process.exit(2);
  }
  const result = await reindexAll(async (applicationId) => {
    const status = await analyzeApplication(applicationId);
    console.log(`candidature ${applicationId} : ${status}`);
  });
  console.log(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
