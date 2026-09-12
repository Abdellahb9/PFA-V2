// Un `dataSource` non-tableau ne doit jamais emporter l'application.
//
// AntD appelle `dataSource.some(...)` sans vérifier le type. Quand la pastille
// « demandes en attente » de la barre latérale a écrasé le cache partagé avec un
// NOMBRE, la page des demandes d'échange a reçu cet entier comme dataSource et
// l'erreur est remontée jusqu'à l'error boundary : écran blanc sur toute l'app.
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import SkeletonTable from "@/components/SkeletonTable";

interface Row {
  id: number;
  name: string;
}

const columns = [{ title: "Nom", dataIndex: "name", key: "name" }];

afterEach(() => vi.restoreAllMocks());

describe("SkeletonTable", () => {
  it("affiche les lignes d'un dataSource normal", () => {
    render(
      <SkeletonTable<Row>
        loading={false}
        rowKey="id"
        columns={columns}
        dataSource={[{ id: 1, name: "Meriem Bedda" }]}
      />,
    );
    expect(screen.getByText("Meriem Bedda")).toBeInTheDocument();
  });

  it("dégrade en table vide quand dataSource est un nombre", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <SkeletonTable<Row>
          loading={false}
          rowKey="id"
          columns={columns}
          dataSource={3 as never}
        />,
      ),
    ).not.toThrow();
    expect(spy).toHaveBeenCalled();
  });

  it("dégrade en table vide quand dataSource est un objet d'erreur", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <SkeletonTable<Row>
          loading={false}
          rowKey="id"
          columns={columns}
          dataSource={{ detail: "Non authentifié" } as never}
        />,
      ),
    ).not.toThrow();
  });

  it("accepte l'absence de dataSource sans la signaler comme anormale", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(<SkeletonTable<Row> loading={false} rowKey="id" columns={columns} />),
    ).not.toThrow();
    // D'autres avertissements (AntD, React) peuvent exister : on vérifie
    // seulement que le nôtre ne se déclenche pas sur un cas légitime.
    const ours = spy.mock.calls.filter((c) => String(c[0]).includes("n'est pas un tableau"));
    expect(ours).toHaveLength(0);
  });

  it("montre le squelette pendant le chargement initial", () => {
    render(<SkeletonTable<Row> loading rowKey="id" columns={columns} dataSource={[]} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
