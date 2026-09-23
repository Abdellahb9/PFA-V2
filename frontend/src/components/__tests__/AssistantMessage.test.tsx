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

// Les modèles gpt-oss émettent des marqueurs de citation propriétaires qui
// s'affichaient tels quels dans la réponse : « 【1†L1-L5】 ». Le prompt système
// les interdit maintenant, mais aucun marqueur brut ne doit pouvoir passer.
describe("AssistantMessage — marqueurs de citation", () => {
  it("ne laisse jamais un marqueur brut à l'écran", () => {
    const { container } = render(
      <AssistantMessage content="Sa filière est l'informatique【1†L1-L5】 selon le CV." />,
    );
    expect(container.textContent).not.toContain("【");
    expect(container.textContent).not.toContain("†");
    expect(container.textContent).not.toContain("L1-L5");
  });

  it("transforme le marqueur en badge portant son numéro", () => {
    render(<AssistantMessage content="Réponse【2†source】." />);
    expect(screen.getByTitle("Voir la source 2")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("rend le badge cliquable et remonte l'index au parent", async () => {
    const seen: number[] = [];
    render(<AssistantMessage content="Texte【3†L4-L9】" onCite={(n) => seen.push(n)} />);
    screen.getByTitle("Voir la source 3").click();
    expect(seen).toEqual([3]);
  });

  it("gère la variante ASCII et les marqueurs multiples", () => {
    const { container } = render(
      <AssistantMessage content={"Un【1†a】 deux [2†b] trois【3†c】"} />,
    );
    expect(container.textContent).not.toContain("†");
    expect(screen.getByTitle("Voir la source 1")).toBeInTheDocument();
    expect(screen.getByTitle("Voir la source 2")).toBeInTheDocument();
    expect(screen.getByTitle("Voir la source 3")).toBeInTheDocument();
  });

  it("intercepte aussi un marqueur à l'intérieur d'une liste ou d'un gras", () => {
    const { container } = render(
      <AssistantMessage content={"- **Habib**【1†cv】 : informatique"} />,
    );
    expect(container.textContent).not.toContain("【");
    expect(container.querySelector("li")).not.toBeNull();
  });
});
