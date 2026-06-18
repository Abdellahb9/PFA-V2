// Reusable department form modal, shared by create and edit flows.
import { useEffect } from "react";
import { Modal, Form, Input, InputNumber, message } from "antd";
import { useCreateDepartment, useUpdateDepartment } from "@/api/hooks";
import { apiErrorMessage } from "@/api/client";
import type { Department } from "@/api/types";

interface Props {
  open: boolean;
  onClose: () => void;
  // When provided, the modal is in edit mode and pre-fills with these values.
  department?: Department | null;
}

export default function DepartmentFormModal({ open, onClose, department }: Props) {
  const [form] = Form.useForm();
  const createDept = useCreateDepartment();
  const updateDept = useUpdateDepartment();
  const isEdit = Boolean(department);

  // Pre-fill on edit, reset on create, each time the modal opens.
  useEffect(() => {
    if (!open) return;
    if (department) {
      form.setFieldsValue(department);
    } else {
      form.resetFields();
    }
  }, [open, department, form]);

  const onSubmit = async () => {
    const values = await form.validateFields();
    try {
      if (department) {
        await updateDept.mutateAsync({ id: department.id, body: values });
        message.success("Département modifié");
      } else {
        await createDept.mutateAsync(values);
        message.success("Département créé");
      }
      form.resetFields();
      onClose();
    } catch (err) {
      message.error(apiErrorMessage(err, "Opération impossible"));
    }
  };

  return (
    <Modal
      title={isEdit ? "Modifier le département" : "Nouveau département"}
      open={open}
      onOk={onSubmit}
      onCancel={onClose}
      okText={isEdit ? "Enregistrer" : "Créer"}
      cancelText="Annuler"
      confirmLoading={createDept.isPending || updateDept.isPending}
      forceRender
    >
      <Form form={form} layout="vertical">
        <Form.Item name="code" label="Code" rules={[{ required: true }]}>
          <Input placeholder="DSI" />
        </Form.Item>
        <Form.Item name="name" label="Nom" rules={[{ required: true }]}>
          <Input placeholder="Direction des Systèmes d'Information" />
        </Form.Item>
        <Form.Item name="supervisor_name" label="Encadrant">
          <Input />
        </Form.Item>
        <Form.Item name="capacity" label="Capacité d'accueil" initialValue={1}>
          <InputNumber min={0} style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
