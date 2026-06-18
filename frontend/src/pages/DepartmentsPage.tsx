// Departments list with create / edit (shared modal) and delete.
import { useState } from "react";
import { Button, Card, Popconfirm, Space, message } from "antd";
import { PlusOutlined, DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { useDeleteDepartment, useDepartments } from "@/api/hooks";
import { apiErrorMessage } from "@/api/client";
import SkeletonTable from "@/components/SkeletonTable";
import DepartmentFormModal from "@/components/DepartmentFormModal";
import type { Department } from "@/api/types";

export default function DepartmentsPage() {
  const { data, isLoading, isFetching } = useDepartments();
  const deleteDept = useDeleteDepartment();
  const [modalOpen, setModalOpen] = useState(false);
  // null => create mode; a department => edit mode.
  const [editing, setEditing] = useState<Department | null>(null);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (dept: Department) => {
    setEditing(dept);
    setModalOpen(true);
  };

  const onDelete = async (id: number) => {
    try {
      await deleteDept.mutateAsync(id);
      message.success("Département supprimé");
    } catch (err) {
      message.error(apiErrorMessage(err, "Suppression impossible"));
    }
  };

  const columns = [
    { title: "Code", dataIndex: "code", key: "code" },
    { title: "Nom", dataIndex: "name", key: "name" },
    {
      title: "Encadrant",
      dataIndex: "supervisor_name",
      key: "supervisor",
      render: (v: string) => v ?? "—",
    },
    { title: "Capacité", dataIndex: "capacity", key: "capacity" },
    {
      title: "Actions",
      key: "actions",
      width: 200,
      render: (_: unknown, r: Department) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
            Modifier
          </Button>
          <Popconfirm
            title="Supprimer ce département ?"
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
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="Départements"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Nouveau département
        </Button>
      }
    >
      <SkeletonTable<Department>
        rowKey="id"
        loading={isLoading}
        fetching={isFetching}
        dataSource={data}
        columns={columns}
        pagination={false}
      />

      <DepartmentFormModal
        open={modalOpen}
        department={editing}
        onClose={() => setModalOpen(false)}
      />
    </Card>
  );
}
