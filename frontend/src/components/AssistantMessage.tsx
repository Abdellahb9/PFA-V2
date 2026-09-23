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
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Typography } from "antd";

interface Props {
  content: string;
  /** Curseur de frappe affiché pendant le streaming. */
  streaming?: boolean;
}

export default function AssistantMessage({ content, streaming }: Props) {
  return (
    <div className="assistant-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }: { children?: ReactNode }) => (
            <Typography.Paragraph style={{ marginBottom: 8 }}>{children}</Typography.Paragraph>
          ),
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
        {content}
      </ReactMarkdown>
      {streaming && content ? <span style={{ opacity: 0.5 }}>▍</span> : null}
    </div>
  );
}
