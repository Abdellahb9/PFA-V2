// Génère la présentation du projet — identité visuelle reprise du produit :
// fond quasi noir, vert de marque, cartes arrondies, pastilles numérotées.
const pptx = new (require("pptxgenjs"))();
const fs = require("fs");
const path = require("path");

pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
pptx.author = "Abdellah Bedda";
pptx.company = "OCP";
pptx.title = "Assistant IA de gestion des stages";

// ---- Palette (dérivée du produit, pas générique) --------------------------
const BG = "0A0A0A";
const CARD = "18181A";
const CARD_HI = "202024";
const BRAND = "76B900";
const BRAND_HI = "8FD400";
const WHITE = "FFFFFF";
const MUTED = "9AA4AE";
const LINE = "2A2A2A";

const H = "Arial"; // titres — police sûre
const B = "Calibri"; // corps — police sûre

const M = 0.7; // marge
const W = 13.33;

// ---- Fabriques communes ---------------------------------------------------
const slide = () => {
  const s = pptx.addSlide();
  s.background = { color: BG };
  return s;
};

const title = (s, text, sub) => {
  s.addText(text, {
    x: M, y: 0.45, w: W - 2 * M, h: 0.75,
    fontFace: H, fontSize: 34, bold: true, color: WHITE, margin: 0,
  });
  if (sub) {
    s.addText(sub, {
      x: M, y: 1.18, w: W - 2 * M, h: 0.42,
      fontFace: B, fontSize: 14, color: MUTED, margin: 0,
    });
  }
};

// Pastille verte numérotée / icône — le motif répété du deck.
const pill = (s, x, y, label, size = 0.46) => {
  s.addShape(pptx.ShapeType.ellipse, {
    x, y, w: size, h: size,
    fill: { color: BRAND }, line: { color: BRAND },
  });
  s.addText(label, {
    x, y, w: size, h: size,
    fontFace: H, fontSize: 14, bold: true, color: "0A0A0A",
    align: "center", valign: "middle", margin: 0,
  });
};

const card = (s, x, y, w, h, fill = CARD) =>
  s.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.09,
    fill: { color: fill }, line: { color: LINE, width: 1 },
  });

// =========================================================== 1. Couverture
{
  const s = slide();
  // Halo vert discret en bas, comme le fond du produit.
  s.addShape(pptx.ShapeType.ellipse, {
    x: -6, y: 6.15, w: 26, h: 5.5,
    fill: { color: BRAND, transparency: 93 }, line: { color: BRAND, transparency: 100 },
  });

  s.addText("OCP", {
    x: M, y: 1.5, w: 6, h: 0.4,
    fontFace: H, fontSize: 16, bold: true, color: BRAND, charSpacing: 3, margin: 0,
  });
  s.addText("Assistant IA de\ngestion des stages", {
    x: M, y: 2.0, w: 8.6, h: 2.1,
    fontFace: H, fontSize: 46, bold: true, color: WHITE, lineSpacing: 50, margin: 0,
  });
  s.addText(
    "Automatiser le tri des candidatures, expliquer chaque décision,\net affecter les stagiaires de façon optimale.",
    { x: M, y: 4.25, w: 8.6, h: 0.9, fontFace: B, fontSize: 16, color: MUTED, margin: 0 },
  );
  s.addText("Projet de fin d'année  ·  Abdellah Bedda", {
    x: M, y: 6.5, w: 8, h: 0.35, fontFace: B, fontSize: 13, color: MUTED, margin: 0,
  });

  // Bloc de chiffres à droite
  const stats = [["19", "endpoints"], ["84", "tests"], ["16", "tables"], ["9", "diagrammes UML"]];
  stats.forEach((st, i) => {
    const x = 9.6, y = 1.9 + i * 1.15;
    s.addText(st[0], {
      x, y, w: 1.3, h: 0.6, fontFace: H, fontSize: 30, bold: true, color: BRAND, margin: 0,
    });
    s.addText(st[1], {
      x: x + 1.35, y: y + 0.15, w: 2.2, h: 0.4, fontFace: B, fontSize: 13, color: MUTED, margin: 0,
    });
  });
  s.addNotes(
    "Plateforme complète de gestion des stages pour OCP, développée en projet de fin d'année. " +
      "Trois piliers : analyse automatique des CV, affectation optimale, et traçabilité des décisions.",
  );
}

// ============================================================= 2. Problème
{
  const s = slide();
  title(s, "Le problème", "Ce que coûte le traitement manuel des candidatures de stage");

  const items = [
    ["Volume", "Des centaines de CV reçus par campagne, au format libre, à lire un par un."],
    ["Subjectivité", "Le rapprochement CV / offre dépend du recruteur qui le fait, sans critère traçable."],
    ["Vision partielle", "Chaque offre est pourvue isolément : personne n'optimise l'ensemble."],
  ];
  items.forEach((it, i) => {
    const x = M + i * 4.15;
    card(s, x, 2.0, 3.85, 3.0);
    pill(s, x + 0.35, 2.35, String(i + 1));
    s.addText(it[0], {
      x: x + 0.35, y: 3.0, w: 3.15, h: 0.45,
      fontFace: H, fontSize: 19, bold: true, color: WHITE, margin: 0,
    });
    s.addText(it[1], {
      x: x + 0.35, y: 3.5, w: 3.15, h: 1.3,
      fontFace: B, fontSize: 14, color: MUTED, margin: 0,
    });
  });

  s.addText(
    "Conséquence : des délais longs, des affectations sous-optimales, et aucune justification opposable.",
    { x: M, y: 5.4, w: W - 2 * M, h: 0.5, fontFace: B, fontSize: 15, italic: true, color: BRAND_HI, margin: 0 },
  );
  s.addNotes("Le point clé est le troisième : une affectation offre par offre ne donne jamais l'optimum global.");
}

// ============================================================= 3. Le flux
{
  const s = slide();
  title(s, "Le parcours, de bout en bout", "Du dépôt du CV à la réservation d'une place de stage");

  const steps = [
    ["Postuler", "Le candidat dépose son CV et précise la période souhaitée."],
    ["Analyser", "Le CV est lu par un LLM : compétences, formation, expérience."],
    ["Scorer", "Chaque couple candidat / offre reçoit un score détaillé."],
    ["Affecter", "L'algorithme hongrois calcule l'affectation optimale globale."],
    ["Réserver", "Le recruteur valide : la place est réservée sur la période."],
  ];
  const w = 2.28, gap = 0.16;
  steps.forEach((st, i) => {
    const x = M + i * (w + gap);
    card(s, x, 2.15, w, 2.6, i === 3 ? CARD_HI : CARD);
    pill(s, x + 0.3, 2.45, String(i + 1), 0.42);
    s.addText(st[0], {
      x: x + 0.3, y: 3.05, w: w - 0.6, h: 0.4,
      fontFace: H, fontSize: 16, bold: true, color: i === 3 ? BRAND : WHITE, margin: 0,
    });
    s.addText(st[1], {
      x: x + 0.3, y: 3.5, w: w - 0.6, h: 1.1,
      fontFace: B, fontSize: 12, color: MUTED, margin: 0,
    });
    if (i < steps.length - 1) {
      s.addText("›", {
        x: x + w + 0.01, y: 3.15, w: 0.16, h: 0.4,
        fontFace: H, fontSize: 20, color: BRAND, align: "center", margin: 0,
      });
    }
  });

  s.addText(
    "L'analyse du CV est asynchrone : le candidat reçoit sa confirmation immédiatement,\nle traitement se poursuit en arrière-plan.",
    { x: M, y: 5.15, w: 8.5, h: 0.8, fontFace: B, fontSize: 14, color: MUTED, margin: 0 },
  );
  s.addNotes("L'étape 4 est le cœur différenciant : optimum global, pas un remplissage glouton offre par offre.");
}

// ======================================================= 4. Stack technique
{
  const s = slide();
  title(s, "Technologies", "Une application entièrement sans serveur, déployée en continu");

  const layers = [
    ["Interface", "React 18  ·  TypeScript  ·  Vite  ·  Ant Design 5\nRedux Toolkit  ·  TanStack Query  ·  Recharts"],
    ["API", "Fonctions serverless TypeScript\nZod (validation)  ·  Vercel  ·  Netlify"],
    ["Données", "PostgreSQL (Supabase)  ·  RLS activée\nSupabase Auth (JWT)  ·  Supabase Storage"],
    ["Intelligence", "Groq — gpt-oss (extraction, agent)\nXGBoost  ·  Algorithme hongrois  ·  Recherche plein-texte"],
    ["Qualité", "Vitest  ·  pytest  ·  ESLint  ·  ruff / black\nGitHub Actions (3 chaînes)"],
    ["Socle alternatif", "FastAPI  ·  SQLAlchemy  ·  Celery  ·  Redis\npgvector  ·  spaCy  ·  Docker"],
  ];
  layers.forEach((l, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = M + col * 4.15, y = 2.0 + row * 2.35;
    card(s, x, y, 3.85, 2.05);
    s.addShape(pptx.ShapeType.ellipse, {
      x: x + 0.35, y: y + 0.32, w: 0.16, h: 0.16,
      fill: { color: BRAND }, line: { color: BRAND },
    });
    s.addText(l[0], {
      x: x + 0.62, y: y + 0.22, w: 3.0, h: 0.36,
      fontFace: H, fontSize: 17, bold: true, color: WHITE, margin: 0,
    });
    s.addText(l[1], {
      x: x + 0.35, y: y + 0.75, w: 3.2, h: 1.1,
      fontFace: B, fontSize: 12.5, color: MUTED, lineSpacing: 17, margin: 0,
    });
  });
  s.addNotes(
    "Le socle FastAPI est une seconde implémentation du même domaine, gardée pour les fonctions " +
      "qui exigent pgvector et spaCy. La parité de scoring entre les deux est vérifiée par des tests partagés.",
  );
}

// ========================================================= 5. Architecture
{
  const s = slide();
  title(s, "Architecture", "Trois couches, aucun serveur à administrer");

  const box = (x, y, w, h, label, sub, accent) => {
    card(s, x, y, w, h, accent ? CARD_HI : CARD);
    s.addText(label, {
      x: x + 0.25, y: y + 0.22, w: w - 0.5, h: 0.35,
      fontFace: H, fontSize: 15, bold: true, color: accent ? BRAND : WHITE, margin: 0,
    });
    s.addText(sub, {
      x: x + 0.25, y: y + 0.62, w: w - 0.5, h: h - 0.85,
      fontFace: B, fontSize: 12, color: MUTED, lineSpacing: 16, margin: 0,
    });
  };

  box(M, 2.1, 3.5, 2.3, "Navigateur", "Application React\nAuthentification Supabase\nTéléversement direct du CV");
  box(M + 4.05, 2.1, 3.5, 2.3, "Fonction serverless", "19 endpoints /api/*\nNoyau partagé testable\nDurée max. 60 s", true);
  box(M + 8.1, 2.1, 3.43, 2.3, "Services managés", "PostgreSQL + Storage\nAuthentification\nGroq (LLM)");

  [4.35, 8.4].forEach((x) => {
    s.addShape(pptx.ShapeType.line, {
      x, y: 3.25, w: 0.5, h: 0,
      line: { color: BRAND, width: 2, endArrowType: "triangle" },
    });
  });

  const notes = [
    "Le CV ne traverse jamais la fonction : le navigateur l'envoie au stockage via une URL signée.",
    "La base n'est jamais interrogée depuis le navigateur — RLS active, aucune police anonyme.",
    "Une seule fonction sert toutes les routes ; le modèle XGBoost est embarqué au build.",
  ];
  notes.forEach((n, i) => {
    const y = 4.85 + i * 0.55;
    s.addShape(pptx.ShapeType.ellipse, {
      x: M + 0.02, y: y + 0.09, w: 0.13, h: 0.13,
      fill: { color: BRAND }, line: { color: BRAND },
    });
    s.addText(n, {
      x: M + 0.32, y, w: W - 2 * M - 0.4, h: 0.4,
      fontFace: B, fontSize: 13, color: MUTED, margin: 0,
    });
  });
  s.addNotes("Le choix serverless supprime l'administration système et facture à l'usage réel.");
}

// ================================================================== 6. L'IA
{
  const s = slide();
  title(s, "L'intelligence artificielle, en détail", "Quatre briques, chacune avec un rôle précis");

  const bricks = [
    ["Extraction des CV", "Un LLM lit le PDF et en tire un profil structuré : compétences normalisées, niveau d'études, expérience. Les résultats sont mis en cache par empreinte du texte — un CV déjà vu ne consomme aucun jeton."],
    ["Score explicable", "Chaque couple candidat / offre reçoit un score pondéré, décomposé par critère. Le recruteur voit d'où vient le chiffre : ce n'est pas une boîte noire."],
    ["Affectation optimale", "L'algorithme hongrois résout l'ensemble des affectations d'un coup, place par place. Le résultat est un optimum global, pas un remplissage successif."],
    ["Prévision de capacité", "Un modèle XGBoost entraîné hors ligne anticipe la demande par département et recommande le nombre de places à ouvrir."],
  ];
  bricks.forEach((b, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = M + col * 6.2, y = 2.0 + row * 2.4;
    card(s, x, y, 5.9, 2.1);
    pill(s, x + 0.32, y + 0.3, String(i + 1), 0.4);
    s.addText(b[0], {
      x: x + 0.85, y: y + 0.32, w: 4.7, h: 0.38,
      fontFace: H, fontSize: 17, bold: true, color: WHITE, margin: 0,
    });
    s.addText(b[1], {
      x: x + 0.32, y: y + 0.85, w: 5.25, h: 1.1,
      fontFace: B, fontSize: 12.5, color: MUTED, lineSpacing: 16, margin: 0,
    });
  });
  s.addNotes("Le cache d'extraction est ce qui rend l'usage soutenable : ré-analyser un CV identique est gratuit.");
}

// ================================================= 7. Assistant conversationnel
{
  const s = slide();
  title(s, "L'assistant conversationnel", "Un agent qui choisit lui-même où chercher");

  card(s, M, 2.05, 6.0, 3.9);
  s.addText("Ce qu'il sait faire", {
    x: M + 0.35, y: 2.3, w: 5.3, h: 0.4,
    fontFace: H, fontSize: 18, bold: true, color: WHITE, margin: 0,
  });
  const tools = [
    "Rechercher des profils de candidats",
    "Interroger les documents de référence",
    "Expliquer le score d'une affectation",
    "Consulter les offres et les réservations",
  ];
  tools.forEach((t, i) => {
    const y = 2.95 + i * 0.58;
    s.addShape(pptx.ShapeType.ellipse, {
      x: M + 0.38, y: y + 0.08, w: 0.14, h: 0.14,
      fill: { color: BRAND }, line: { color: BRAND },
    });
    s.addText(t, {
      x: M + 0.68, y, w: 5.0, h: 0.4,
      fontFace: B, fontSize: 13.5, color: MUTED, margin: 0,
    });
  });
  s.addText("Il garde le fil : « et sa filière ? » porte bien sur le candidat précédent.", {
    x: M + 0.35, y: 5.35, w: 5.3, h: 0.5,
    fontFace: B, fontSize: 12.5, italic: true, color: BRAND_HI, margin: 0,
  });

  card(s, M + 6.35, 2.05, 5.58, 3.9, CARD_HI);
  s.addText("Comment il fonctionne", {
    x: M + 6.7, y: 2.3, w: 4.9, h: 0.4,
    fontFace: H, fontSize: 18, bold: true, color: WHITE, margin: 0,
  });
  const flow = [
    ["Question", "reçue avec tout l'historique"],
    ["Décision", "le modèle choisit ses outils"],
    ["Recherche", "les outils interrogent la base"],
    ["Réponse", "diffusée mot à mot"],
  ];
  flow.forEach((f, i) => {
    const y = 2.95 + i * 0.62;
    pill(s, M + 6.7, y, String(i + 1), 0.36);
    s.addText(f[0], {
      x: M + 7.2, y: y + 0.01, w: 1.5, h: 0.34,
      fontFace: H, fontSize: 13.5, bold: true, color: BRAND, margin: 0,
    });
    s.addText(f[1], {
      x: M + 8.6, y: y + 0.03, w: 3.2, h: 0.34,
      fontFace: B, fontSize: 12.5, color: MUTED, margin: 0,
    });
  });
  s.addText("Les réponses ne s'appuient que sur les données retrouvées.", {
    x: M + 6.7, y: 5.35, w: 4.9, h: 0.5,
    fontFace: B, fontSize: 12.5, italic: true, color: BRAND_HI, margin: 0,
  });
  s.addNotes("Le passage d'un routage figé à un agent à outils est ce qui rend la conversation possible.");
}

// ============================================================ 8. Modélisation
{
  const s = slide();
  title(s, "Modélisation UML", "Neuf diagrammes couvrant l'analyse et la conception");

  const img = path.resolve(__dirname, "../uml/img/09-deploiement.png");
  card(s, M, 1.95, W - 2 * M, 3.6, "FFFFFF");
  if (fs.existsSync(img)) {
    s.addImage({ path: img, x: M + 0.25, y: 2.12, w: 11.43, h: 3.26, sizing: { type: "contain", w: 11.43, h: 3.26 } });
  }
  s.addText("Diagramme de déploiement — configuration de production", {
    x: M, y: 5.65, w: 7.5, h: 0.35, fontFace: B, fontSize: 12, color: MUTED, margin: 0,
  });
  s.addText("Cas d'utilisation · Classes · Séquence (3) · États-transitions · Activités · Composants · Déploiement", {
    x: M, y: 6.1, w: W - 2 * M, h: 0.5, fontFace: B, fontSize: 13, color: WHITE, margin: 0,
  });
  s.addNotes("Chaque diagramme est livré en PlantUML, en Mermaid et en image, versionnés avec le code.");
}

// ================================================================ 9. Qualité
{
  const s = slide();
  title(s, "Qualité et industrialisation", "Ce qui protège le projet des régressions");

  s.addChart(
    pptx.ChartType.bar,
    [{ name: "Tests automatisés", labels: ["API serverless", "Backend Python", "Interface"], values: [50, 25, 9] }],
    {
      x: M, y: 2.0, w: 6.0, h: 3.4,
      barDir: "col",
      chartColors: [BRAND],
      showTitle: true,
      title: "84 tests automatisés",
      titleColor: WHITE,
      titleFontSize: 15,
      titleFontFace: H,
      showValue: true,
      dataLabelPosition: "outEnd",
      dataLabelColor: WHITE,
      dataLabelFontSize: 12,
      showLegend: false,
      catAxisLabelColor: MUTED,
      valAxisLabelColor: MUTED,
      catAxisLabelFontSize: 11,
      valAxisLabelFontSize: 11,
      valGridLine: { color: LINE, size: 1 },
      catGridLine: { style: "none" },
      plotArea: { fill: { color: BG } },
      chartArea: { fill: { color: BG } },
    },
  );

  const points = [
    ["Intégration continue", "Trois chaînes à chaque envoi : interface, API, backend Python."],
    ["Parité vérifiée", "Le score existe en TypeScript et en Python : un jeu d'essai commun garantit le même résultat."],
    ["Migrations versionnées", "11 migrations SQL, rejouables, avec la sécurité au niveau des lignes activée partout."],
  ];
  points.forEach((p, i) => {
    const y = 2.1 + i * 1.15;
    card(s, M + 6.35, y, 5.58, 1.0);
    s.addText(p[0], {
      x: M + 6.65, y: y + 0.14, w: 5.0, h: 0.32,
      fontFace: H, fontSize: 14.5, bold: true, color: BRAND, margin: 0,
    });
    s.addText(p[1], {
      x: M + 6.65, y: y + 0.48, w: 5.0, h: 0.45,
      fontFace: B, fontSize: 12, color: MUTED, margin: 0,
    });
  });
  s.addNotes("La parité TS/Python est le test le plus précieux : il empêche les deux implémentations de diverger.");
}

// =============================================================== 10. Livré
{
  const s = slide();
  title(s, "Ce qui est livré", "Application en production, fonctionnalités opérationnelles");

  const feats = [
    ["Portail public", "Consultation des offres, candidature avec CV et période souhaitée."],
    ["Espace candidat", "Suivi de l'avancement de chaque candidature."],
    ["Tableau de bord", "Indicateurs et graphiques sur l'ensemble de la campagne."],
    ["Affectation IA", "Optimisation globale, score détaillé, validation par le recruteur."],
    ["Offres réservées", "Places occupées par période, groupées par mois."],
    ["Assistant conversationnel", "Recherche en langage naturel sur toutes les données."],
  ];
  feats.forEach((f, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = M + col * 4.15, y = 2.0 + row * 2.15;
    card(s, x, y, 3.85, 1.85);
    s.addShape(pptx.ShapeType.ellipse, {
      x: x + 0.32, y: y + 0.3, w: 0.3, h: 0.3,
      fill: { color: BRAND }, line: { color: BRAND },
    });
    s.addText("✓", {
      x: x + 0.32, y: y + 0.3, w: 0.3, h: 0.3,
      fontFace: H, fontSize: 12, bold: true, color: "0A0A0A", align: "center", valign: "middle", margin: 0,
    });
    s.addText(f[0], {
      x: x + 0.72, y: y + 0.26, w: 2.9, h: 0.38,
      fontFace: H, fontSize: 14.5, bold: true, color: WHITE, margin: 0,
    });
    s.addText(f[1], {
      x: x + 0.32, y: y + 0.78, w: 3.2, h: 0.9,
      fontFace: B, fontSize: 12, color: MUTED, lineSpacing: 15, margin: 0,
    });
  });
  s.addNotes("Tout est déployé et utilisable ; le déploiement est déclenché à chaque évolution.");
}

// ========================================================= 11. Perspectives
{
  const s = slide();
  title(s, "Limites et suites", "Ce qui est assumé aujourd'hui, ce qui viendrait ensuite");

  card(s, M, 2.05, 5.9, 3.7);
  s.addText("Limites assumées", {
    x: M + 0.35, y: 2.3, w: 5.2, h: 0.4,
    fontFace: H, fontSize: 18, bold: true, color: WHITE, margin: 0,
  });
  const limits = [
    "Recherche documentaire par mots-clés, sans vecteurs sémantiques.",
    "Pas de limite de débit par utilisateur sur l'assistant.",
    "L'expérience non extraite d'un CV est enregistrée à zéro.",
  ];
  limits.forEach((l, i) => {
    const y = 2.9 + i * 0.85;
    s.addShape(pptx.ShapeType.ellipse, {
      x: M + 0.38, y: y + 0.08, w: 0.13, h: 0.13,
      fill: { color: MUTED }, line: { color: MUTED },
    });
    s.addText(l, {
      x: M + 0.68, y, w: 4.9, h: 0.7,
      fontFace: B, fontSize: 13, color: MUTED, margin: 0,
    });
  });

  card(s, M + 6.25, 2.05, 5.68, 3.7, CARD_HI);
  s.addText("Prochaines étapes", {
    x: M + 6.6, y: 2.3, w: 5.0, h: 0.4,
    fontFace: H, fontSize: 18, bold: true, color: WHITE, margin: 0,
  });
  const next = [
    ["Recherche sémantique", "vecteurs pgvector pour les synonymes"],
    ["Quotas par utilisateur", "maîtriser le coût des appels au modèle"],
    ["Actions guidées", "laisser l'assistant agir, sous confirmation"],
  ];
  next.forEach((n, i) => {
    const y = 2.9 + i * 0.85;
    pill(s, M + 6.6, y, String(i + 1), 0.36);
    s.addText(n[0], {
      x: M + 7.1, y: y + 0.0, w: 4.4, h: 0.32,
      fontFace: H, fontSize: 14, bold: true, color: BRAND, margin: 0,
    });
    s.addText(n[1], {
      x: M + 7.1, y: y + 0.33, w: 4.4, h: 0.32,
      fontFace: B, fontSize: 12, color: MUTED, margin: 0,
    });
  });
  s.addNotes("Annoncer les limites soi-même vaut mieux que de les laisser découvrir en questions.");
}

// =============================================================== 12. Clôture
{
  const s = slide();
  s.addShape(pptx.ShapeType.ellipse, {
    x: -6, y: 6.15, w: 26, h: 5.5,
    fill: { color: BRAND, transparency: 93 }, line: { color: BRAND, transparency: 100 },
  });
  s.addText("Merci", {
    x: M, y: 2.5, w: 8, h: 1.1,
    fontFace: H, fontSize: 52, bold: true, color: WHITE, margin: 0,
  });
  s.addText(
    "Une plateforme qui lit les CV, justifie ses scores,\net affecte les stagiaires de façon optimale.",
    { x: M, y: 3.7, w: 8.4, h: 1.0, fontFace: B, fontSize: 17, color: MUTED, margin: 0 },
  );
  s.addText("Questions", {
    x: M, y: 5.1, w: 4, h: 0.5,
    fontFace: H, fontSize: 18, bold: true, color: BRAND, margin: 0,
  });
  s.addText("Assistant IA de gestion des stages  ·  OCP", {
    x: M, y: 6.6, w: 8, h: 0.35, fontFace: B, fontSize: 12, color: MUTED, margin: 0,
  });
  s.addNotes("Terminer sur la démonstration : parcours candidat, affectation, puis assistant conversationnel.");
}

const out = path.resolve(__dirname, "Assistant-IA-Stages-OCP.pptx");
pptx.writeFile({ fileName: out }).then(() => console.log("écrit :", out));
