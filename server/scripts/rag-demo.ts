// Démonstration de bout en bout contre les VRAIS services : dépose le document
// d'exemple, le vectorise, pose une question à l'agent et affiche la réponse.
//
//   (à la racine du dépôt)
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… MISTRAL_API_KEY=… GROQ_API_KEY=… \
//     npm run rag:demo -- "Quels logiciels de simulation Yasmine El Amrani maîtrise-t-elle ?"
//
// Prérequis : migration 0019 appliquée. Le document de démonstration est
// supprimé à la fin, sauf avec --keep. La version hors ligne de ce scénario
// tourne dans la suite de tests (server/lib/rag/__tests__/e2e.test.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  embeddingsEnabled,
  embedPending,
  getStore,
  ingestPages,
  retrieveDocChunks,
  runAgent,
} from "../lib/rag";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE = join(HERE, "..", "lib", "rag", "__fixtures__", "cv-yasmine-el-amrani.md");
const DOC_NAME = "demo-cv-yasmine-el-amrani.pdf";

async function main() {
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GROQ_API_KEY"].filter(
    (k) => !process.env[k],
  );
  if (missing.length) {
    console.error(`Variables manquantes : ${missing.join(", ")}`);
    process.exit(1);
  }
  const keep = process.argv.includes("--keep");
  const question =
    process.argv.slice(2).find((a) => !a.startsWith("--")) ??
    "Quels logiciels de simulation Yasmine El Amrani maîtrise-t-elle ?";

  // 1. Ingestion — une ligne « <!-- page --> » simule les pages d'un PDF.
  const pages = readFileSync(FIXTURE, "utf8")
    .split(/^<!-- page -->$/m)
    .map((text, i) => ({ page: i + 1, text }));
  const ingested = await ingestPages(DOC_NAME, pages, "cv", true);
  console.log(`1. ingéré : ${ingested.chunks} extraits (vectorisation : ${ingested.embeddings})`);

  // 2. Vectorisation — en production, c'est rag-embed-background qui s'en charge.
  if (embeddingsEnabled()) {
    console.log(`2. vectorisé : ${await embedPending()} extraits`);
  } else {
    console.log("2. MISTRAL_API_KEY absente : recherche plein-texte seule");
  }

  // 3. Recherche brute, pour voir ce que l'agent recevra.
  console.log(`3. recherche : « ${question} »`);
  for (const c of await retrieveDocChunks(question, 3)) {
    console.log(`   - ${c.source_document} p.${c.page ?? "?"} [${c.heading ?? "—"}] pertinence ${c.similarity}`);
  }

  // 4. Agent.
  process.stdout.write("4. réponse : ");
  for await (const event of runAgent([{ role: "user", content: question }])) {
    if (event.type === "delta") process.stdout.write(event.text);
    else if (event.type === "tool") process.stdout.write(`\n   [outil ${event.name} ${JSON.stringify(event.args)}]\n   `);
    else if (event.type === "error") process.stdout.write(`\n   [erreur] ${event.message}`);
  }
  process.stdout.write("\n");

  if (!keep) {
    await getStore().deleteDocument(DOC_NAME);
    console.log(`5. document de démonstration supprimé (--keep pour le conserver)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
