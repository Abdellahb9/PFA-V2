// Le texte de l'assistant s'affichait en brut : « **Universiapolis** » gardait
// ses astérisques. Ces tests verrouillent le rendu markdown ET la propriété qui
// compte le plus ici : le contenu vient d'un LLM nourri de documents déposés par
// des tiers, donc tout HTML qu'il produirait doit rester du texte inerte.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AssistantMessage from "@/components/AssistantMessage";

describe("AssistantMessage — rendu markdown", () => {
  it("rend le gras au lieu d'afficher les astérisques", () => {
    const { container } = render(
      <AssistantMessage content="**Universiapolis (Université Internationale d'Agadir)**" />,
    );
    expect(container.querySelector("strong")).not.toBeNull();
    expect(container.textContent).not.toContain("**");
    expect(screen.getByText(/Universiapolis/)).toBeInTheDocument();
  });

  it("rend les listes et l'italique", () => {
    const { container } = render(
      <AssistantMessage content={"- premier\n- second\n\nUn mot en *italique*."} />,
    );
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("em")).not.toBeNull();
  });

  it("rend un tableau GFM dans un conteneur qui défile", () => {
    const md = "| Nom | Score |\n| --- | --- |\n| Habib | 71 % |";
    const { container } = render(<AssistantMessage content={md} />);
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("div[style*='overflow']")).not.toBeNull();
  });
});

describe("AssistantMessage — sûreté", () => {
  it("n'exécute pas le HTML brut, il l'affiche comme texte", () => {
    const hostile = 'Bonjour <img src=x onerror="alert(1)"> <script>alert(2)</script>';
    const { container } = render(<AssistantMessage content={hostile} />);

    // Aucun nœud réel ne doit être créé à partir du balisage.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    // Le balisage doit être ÉCHAPPÉ, donc présent sous forme de texte inerte.
    // (innerHTML contient bien « onerror », mais à l'intérieur de « &lt;img … »,
    // c'est-à-dire du texte affiché, jamais un attribut exécuté.)
    expect(container.innerHTML).toContain("&lt;img");
    expect(container.textContent).toContain("<img");
  });

  it("ne suit pas un lien markdown sans protections", () => {
    const { container } = render(<AssistantMessage content="[lien](https://exemple.ma)" />);
    const a = container.querySelector("a");
    expect(a?.getAttribute("rel")).toContain("noopener");
    expect(a?.getAttribute("target")).toBe("_blank");
  });

  it("supporte un contenu vide sans casser", () => {
    expect(() => render(<AssistantMessage content="" />)).not.toThrow();
  });
});
