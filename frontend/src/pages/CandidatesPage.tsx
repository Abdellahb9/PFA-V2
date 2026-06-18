// Candidates list with search and extracted-skill tags.
import { useState } from "react";
import { Card, Tag, Input, Space } from "antd";
import { useCandidates } from "@/api/hooks";
import SkeletonTable from "@/components/SkeletonTable";
import type { Candidate, SkillRef } from "@/api/types";

export default function CandidatesPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading, isFetching } = useCandidates(search || undefined);

  const columns = [
    { title: "Nom", dataIndex: "full_name", key: "full_name" },
    { title: "Filière", dataIndex: "field_of_study", key: "field", render: (v: string) => v ?? "—" },
    { title: "Niveau", dataIndex: "education_level", key: "level", render: (v: string) => v ?? "—" },
    { title: "Université", dataIndex: "university", key: "university", render: (v: string) => v ?? "—" },
    {
      title: "Compétences détectées",
      dataIndex: "skills",
      key: "skills",
      render: (skills: SkillRef[]) => (
        <Space size={[0, 4]} wrap>
          {skills.slice(0, 6).map((s) => (
            <Tag key={s.name} color="green">
              {s.name}
            </Tag>
          ))}
          {skills.length > 6 && <Tag>+{skills.length - 6}</Tag>}
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="Candidats"
      extra={
        <Input.Search
          placeholder="Rechercher par nom ou filière"
          style={{ width: 280 }}
          onSearch={setSearch}
          allowClear
        />
      }
    >
      <SkeletonTable<Candidate>
        rowKey="id"
        loading={isLoading}
        fetching={isFetching}
        dataSource={data}
        columns={columns}
        pagination={{ pageSize: 10 }}
      />
    </Card>
  );
}
