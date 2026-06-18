// Internship offers list + create modal (with required skills + slots).
import { useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Tag,
  message,
} from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { useCreateOffer, useDeleteOffer, useDepartments, useOffers } from "@/api/hooks";
import { apiErrorMessage } from "@/api/client";
import SkeletonTable from "@/components/SkeletonTable";
import type { Offer, OfferStatus, SkillRef } from "@/api/types";

const STATUS_COLOR: Record<OfferStatus, string> = {
  open: "green",
  closed: "red",
  draft: "default",
};

export default function OffersPage() {
  const { data: offers, isLoading, isFetching } = useOffers();
  const { data: departments } = useDepartments();
  const createOffer = useCreateOffer();
  const deleteOffer = useDeleteOffer();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const onDelete = async (id: number) => {
    try {
      await deleteOffer.mutateAsync(id);
      message.success("Offre supprimée");
    } catch (err) {
      message.error(apiErrorMessage(err, "Suppression impossible"));
    }
  };

  const columns = [
    { title: "Titre", dataIndex: "title", key: "title" },
    { title: "Filière", dataIndex: "field", key: "field", render: (v: string) => v ?? "—" },
    { title: "Postes", dataIndex: "slots", key: "slots" },
    {
      title: "Compétences requises",
      dataIndex: "skills",
      key: "skills",
      render: (skills: SkillRef[]) => (
        <>
          {skills.map((s) => (
            <Tag key={s.name} color="blue">
              {s.name}
            </Tag>
          ))}
        </>
      ),
    },
    {
      title: "Statut",
      dataIndex: "status",
      key: "status",
      render: (s: OfferStatus) => <Tag color={STATUS_COLOR[s]}>{s}</Tag>,
    },
    {
      title: "Actions",
      key: "actions",
      width: 120,
      render: (_: unknown, r: Offer) => (
        <Popconfirm
          title="Supprimer cette offre ?"
          description="Cette action est irréversible."
          okText="Supprimer"
          cancelText="Annuler"
          okButtonProps={{ danger: true }}
          onConfirm={() => onDelete(r.id)}
        >
          <Button danger size="small" icon={<DeleteOutlined />}>
            Supprimer
          </Button>
        </Popconfirm>
      ),
    },
  ];

  const onCreate = async () => {
    const values = await form.validateFields();
    // Transform the comma-separated skills field into SkillRef[].
    const skills: SkillRef[] = (values.skills ?? []).map((name: string) => ({
      name,
      weight: 1.0,
    }));
    try {
      await createOffer.mutateAsync({ ...values, skills });
      message.success("Offre créée");
      setOpen(false);
      form.resetFields();
    } catch {
      message.error("Échec de la création");
    }
  };

  return (
    <Card
      title="Offres de stage"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Nouvelle offre
        </Button>
      }
    >
      <SkeletonTable<Offer>
        rowKey="id"
        loading={isLoading}
        fetching={isFetching}
        dataSource={offers}
        columns={columns}
        pagination={{ pageSize: 10 }}
      />

      <Modal
        title="Nouvelle offre de stage"
        open={open}
        onOk={onCreate}
        onCancel={() => setOpen(false)}
        okText="Créer"
        cancelText="Annuler"
        confirmLoading={createOffer.isPending}
        width={560}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="department_id" label="Département" rules={[{ required: true }]}>
            <Select
              placeholder="Sélectionner un département"
              options={departments?.map((d) => ({ value: d.id, label: d.name }))}
            />
          </Form.Item>
          <Form.Item name="title" label="Titre" rules={[{ required: true }]}>
            <Input placeholder="Stage Développement IA / NLP" />
          </Form.Item>
          <Form.Item name="field" label="Filière visée">
            <Input placeholder="Informatique" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="slots" label="Nombre de postes" initialValue={1}>
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="min_education_level" label="Niveau minimum">
            <Select
              allowClear
              options={["Bac+2", "Bac+3", "Bac+4", "Bac+5"].map((v) => ({ value: v, label: v }))}
            />
          </Form.Item>
          <Form.Item name="skills" label="Compétences requises">
            <Select
              mode="tags"
              placeholder="python, nlp, machine learning…"
              tokenSeparators={[","]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
