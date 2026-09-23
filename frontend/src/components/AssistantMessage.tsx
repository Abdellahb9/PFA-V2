// Rendu d'une réponse de l'assistant.
//
// Le texte était injecté tel quel dans un <Paragraph> : le markdown produit par
// le modèle s'affichait donc en brut, astérisques comprises
// (« **Universiapolis (Université Internationale d'Agadir)** »). On le rend.
//
// SÉCURITÉ : react-markdown n'interprète PAS le HTML brut — il faudrait ajouter
// rehype-raw pour cela, ce qu'on se garde bien de faire. Le contenu vient d'un
// LLM nourri de documents téléversés par des tiers : il est non fiable par
// construction, et tout balisage HTML qu'il produirait reste du texte.
import { Fragment, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Tag, Typography } from "antd";

// ---- Marqueurs de citation du modèle ----------------------------------------
//
// Les modèles gpt-oss émettent des jetons de citation propriétaires, 【1†L1-L5】,
// qui s'affichaient tels quels dans la réponse. Le prompt système les interdit
// désormais, mais un modèle n'obéit jamais à 100 % : on les intercepte ici pour
// qu'AUCUN marqueur brut ne puisse atteindre l'écran. Le numéro est le seul
// élément exploitable — il désigne la Nième source du tour.

const CITATION_RE = /【\s*(\d+)\s*[†:|]?[^】]*】/g;
/** Variante ASCII, parfois émise quand la sortie a été tronquée. */
const CITATION_ASCII_RE = /\[\s*(\d+)\s*†[^\]]*\]/g;

/** Jeton intermédiaire : il doit survivre au parsing markdown sans être altéré. */
const token = (n: string) => `⟦cite:${n}⟧`;
const TOKEN_SPLIT = /(⟦cite:\d+⟧)/g;

/** Remplace les marqueurs par un jeton neutre. Exporté pour les tests. */
export function normalizeCitations(text: string): string {
  return (text ?? "")
    .replace(CITATION_RE, (_m, n: string) => token(n))
    .replace(CITATION_ASCII_RE, (_m, n: string) => token(n));
}

/** Transforme les jetons présents dans un nœud texte en badges cliquables. */
function withCitations(children: ReactNode, onCite?: (n: number) => void): ReactNode {
  const walk = (node: ReactNode, key: number): ReactNode => {
    if (typeof node !== "string" || !node.includes("⟦cite:")) return node;

    return node.split(TOKEN_SPLIT).map((part, i) => {
      const m = /^⟦cite:(\d+)⟧$/.exec(part);
      if (!m) return <Fragment key={`${key}-${i}`}>{part}</Fragment>;
      const n = Number(m[1]);
      const clickable = Boolean(onCite);
      return (
        <Tag
          key={`${key}-${i}`}
          color="blue"
          role={clickable ? "button" : undefined}
          tabIndex={clickable ? 0 : undefined}
          aria-label={`Voir la source ${n}`}
          title={`Voir la source ${n}`}
          onClick={clickable ? () => onCite?.(n) : undefined}
          onKeyDown={
            clickable
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onCite?.(n);
                  }
                }
              : undefined
          }
          style={{
            cursor: clickable ? "pointer" : "default",
            marginInline: 2,
            fontSize: 11,
            lineHeight: "16px",
            paddingInline: 6,
          }}
        >
          {n}
        </Tag>
      );
    });
  };

  return Array.isArray(children) ? children.map((c, i) => walk(c, i)) : walk(children, 0);
}

interface Props {
  content: string;
  /** Curseur de frappe affiché pendant le streaming. */
  streaming?: boolean;
  /** Ouvre l'extrait correspondant quand l'utilisateur clique un badge. */
  onCite?: (index: number) => void;
}

export default function AssistantMessage({ content, streaming, onCite }: Props) {
  const clean = normalizeCitations(content);
  const cite = (children: ReactNode) => withCitations(children, onCite);

  return (
    <div className="assistant-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }: { children?: ReactNode }) => (
            <Typography.Paragraph style={{ marginBottom: 8 }}>{cite(children)}</Typography.Paragraph>
          ),
          li: ({ children }: { children?: ReactNode }) => <li>{cite(children)}</li>,
          strong: ({ children }: { children?: ReactNode }) => <strong>{cite(children)}</strong>,
          em: ({ children }: { children?: ReactNode }) => <em>{cite(children)}</em>,
          // Liens en nouvel onglet, sans transmettre le référent.
          a: ({ children, href }: { children?: ReactNode; href?: string }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ),
          // Un tableau large défile dans son propre conteneur plutôt que de
          // pousser la colonne de conversation.
          table: ({ children }: { children?: ReactNode }) => (
            <div style={{ overflowX: "auto" }}>
              <table className="assistant-md__table">{children}</table>
            </div>
          ),
        }}
      >
        {clean}
      </ReactMarkdown>
      {streaming && content ? <span style={{ opacity: 0.5 }}>▍</span> : null}
    </div>
  );
}
