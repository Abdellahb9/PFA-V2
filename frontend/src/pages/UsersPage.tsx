// Admin user management (CRM — accounts & roles). Admin only.
import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import { UserAddOutlined } from "@ant-design/icons";
import { useCreateUser, useUpdateUser, useUsers } from "@/api/hooks";
import { apiErrorMessage } from "@/api/client";
import { useAppSelector } from "@/store";
import SkeletonTable from "@/components/SkeletonTable";
import type { AdminUser } from "@/api/types";

// Libellés de TOUS les rôles que la base peut contenir : des comptes portent
// encore « recruiter », leur ligne doit continuer à s'afficher correctement.
const ROLE_LABELS: Record<string, string> = {
  candidate: "Candidat",
  viewer: "Lecteur",
  recruiter: "Recruteur",
  admin: "Administrateur",
};

// Rôles réellement attribuables depuis l'interface. Lecteur et Recruteur en
// sont retirés : ils restent acceptés par l'API pour les comptes existants.
const ASSIGNABLE_ROLES = ["candidate", "admin"] as const;

const roleOptions = (values: readonly string[]) =>
  values.map((value) => ({ value, label: ROLE_LABELS[value] ?? value }));
function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export default function UsersPage() {
  const me = useAppSelector((s) => s.auth.user);
  const { data, isLoading, isFetching } = useUsers();
  const update = useUpdateUser();
  const create = useCreateUser();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const onRole = async (u: AdminUser, role: string) => {
    try {
      await update.mutateAsync({ id: u.id, body: { role } });
      message.success("Rôle mis à jour");
    } catch (err) {
      message.error(apiErrorMessage(err, "Mise à jour impossible"));
    }
  };

  const onActive = async (u: AdminUser, is_active: boolean) => {
    try {
      await update.mutateAsync({ id: u.id, body: { is_active } });
      message.success(is_active ? "Compte activé" : "Compte désactivé");
    } catch (err) {
      message.error(apiErrorMessage(err, "Mise à jour impossible"));
    }
  };

  const onCreate = async () => {
    const v = await form.validateFields();
    try {
      await create.mutateAsync(v);
      message.success("Compte créé");
      form.resetFields();
      setOpen(false);
    } catch (err) {
      message.error(apiErrorMessage(err, "Création impossible"));
    }
  };

  const columns = [
    {
      title: "Utilisateur",
      key: "user",
      render: (_: unknown, u: AdminUser) => (
        <div>
          <div>
            <strong>{u.full_name ?? "—"}</strong>
            {u.id === me?.id && <Tag style={{ marginLeft: 6 }}>vous</Tag>}
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {u.email}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: "Rôle",
      key: "role",
      render: (_: unknown, u: AdminUser) => (
        <Tooltip title={u.id === me?.id ? "Vous ne pouvez pas changer votre propre rôle" : ""}>
          <Select
            size="small"
            value={u.role}
            style={{ width: 150 }}
            disabled={u.id === me?.id}
            options={roleOptions(
              ASSIGNABLE_ROLES.includes(u.role as (typeof ASSIGNABLE_ROLES)[number])
                ? ASSIGNABLE_ROLES
                : [...ASSIGNABLE_ROLES, u.role],
            )}
            onChange={(r) => onRole(u, r)}
          />
        </Tooltip>
      ),
    },
    {
      title: "Email",
      key: "confirmed",
      render: (_: unknown, u: AdminUser) =>
        u.email_confirmed ? <Tag color="green">Confirmé</Tag> : <Tag color="orange">En attente</Tag>,
    },
    {
      title: "Candidatures",
      dataIndex: "application_count",
      key: "apps",
      render: (n: number) => <Tag color={n ? "blue" : "default"}>{n}</Tag>,
    },
    {
      title: "Dernière connexion",
      dataIndex: "last_sign_in_at",
      key: "last",
      render: (v: string | null) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {fmtDate(v)}
        </Typography.Text>
      ),
    },
    {
      title: "Actif",
      key: "active",
      render: (_: unknown, u: AdminUser) => (
        <Switch
          checked={u.is_active}
          disabled={u.id === me?.id}
          onChange={(c) => onActive(u, c)}
        />
      ),
    },
  ];

  return (
    <Card
      title="Utilisateurs"
      extra={
        <Button type="primary" icon={<UserAddOutlined />} onClick={() => setOpen(true)}>
          Créer un compte staff
        </Button>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Gérez les comptes, les rôles et l'accès. Désactiver un compte bloque sa connexion sans le supprimer."
      />
      <SkeletonTable<AdminUser>
        rowKey="id"
        loading={isLoading}
        fetching={isFetching}
        dataSource={data}
        columns={columns}
        pagination={{ pageSize: 12 }}
      />

      <Modal
        title="Créer un compte staff"
        open={open}
        onOk={onCreate}
        onCancel={() => setOpen(false)}
        okText="Créer"
        cancelText="Annuler"
        confirmLoading={create.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ role: "admin" }}>
          <Form.Item name="full_name" label="Nom complet" rules={[{ required: true }]}>
            <Input placeholder="Nom Prénom" />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: "email" }]}>
            <Input placeholder="recruteur@phosboucraa.ma" />
          </Form.Item>
          <Form.Item
            name="password"
            label="Mot de passe provisoire"
            rules={[{ required: true, min: 6, message: "6 caractères minimum" }]}
          >
            <Input.Password placeholder="••••••••" />
          </Form.Item>
          <Form.Item name="role" label="Rôle" rules={[{ required: true }]}>
            <Select options={roleOptions(ASSIGNABLE_ROLES.filter((r) => r !== "candidate"))} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
