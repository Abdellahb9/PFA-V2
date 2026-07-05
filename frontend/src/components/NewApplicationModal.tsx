// Modal form to submit a new internship application with a real CV (PDF/DOCX).
import {
  Modal,
  Form,
  Input,
  Select,
  Upload,
  Button,
  message,
  Row,
  Col,
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { UploadFile } from "antd";
import { useOffers, useSubmitApplication } from "@/api/hooks";

interface Props {
  open: boolean;
  onClose: () => void;
}

const EDUCATION_LEVELS = ["Bac+2", "Bac+3", "Bac+4", "Bac+5", "Doctorat"];

// Extract the AntD Upload event into a fileList for the Form.
const normFile = (e: { fileList: UploadFile[] } | UploadFile[]) =>
  Array.isArray(e) ? e : e?.fileList;

export default function NewApplicationModal({ open, onClose }: Props) {
  const [form] = Form.useForm();
  const { data: offers } = useOffers();
  const submit = useSubmitApplication();

  const onSubmit = async () => {
    const values = await form.validateFields();
    const cvFile = values.cv?.[0]?.originFileObj as File | undefined;
    if (!cvFile) {
      message.error("Le CV est obligatoire");
      return;
    }

    const fields: Record<string, unknown> = {
      first_name: values.first_name,
      last_name: values.last_name,
      email: values.email,
    };
    if (values.phone) fields.phone = values.phone;
    if (values.field_of_study) fields.field_of_study = values.field_of_study;
    if (values.education_level) fields.education_level = values.education_level;
    if (values.university) fields.university = values.university;
    if (values.motivation) fields.motivation = values.motivation;
    if (values.offer_id) fields.offer_id = values.offer_id;

    try {
      await submit.mutateAsync({ fields, file: cvFile });
      message.success("Candidature soumise — analyse du CV en cours…");
      form.resetFields();
      onClose();
    } catch {
      message.error("Échec de la soumission");
    }
  };

  return (
    <Modal
      title="Nouvelle candidature"
      open={open}
      onOk={onSubmit}
      onCancel={onClose}
      okText="Soumettre"
      cancelText="Annuler"
      confirmLoading={submit.isPending}
      width={640}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="first_name" label="Prénom" rules={[{ required: true }]}>
              <Input placeholder="Youssef" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="last_name" label="Nom" rules={[{ required: true }]}>
              <Input placeholder="El Khattabi" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="email"
              label="Email"
              rules={[{ required: true, type: "email" }]}
            >
              <Input placeholder="youssef@example.ma" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="phone"
              label="Téléphone"
              // Strip anything that isn't a digit / phone separator on input.
              getValueFromEvent={(e) => e.target.value.replace(/[^\d+\s().-]/g, "")}
              rules={[
                { required: true, message: "Téléphone requis" },
                {
                  pattern: /^\+?[0-9\s().-]{6,}$/,
                  message: "Numéro invalide (chiffres uniquement)",
                },
              ]}
            >
              <Input inputMode="tel" placeholder="+212 6 12 34 56 78" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="field_of_study" label="Filière">
              <Input placeholder="Informatique" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="education_level" label="Niveau d'études">
              <Select
                allowClear
                options={EDUCATION_LEVELS.map((v) => ({ value: v, label: v }))}
              />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="university" label="Établissement">
          <Input placeholder="ENSA / FST / …" />
        </Form.Item>
        <Form.Item name="offer_id" label="Offre visée (optionnel)">
          <Select
            allowClear
            placeholder="Candidature générale si non précisé"
            options={[
              // Falsy sentinel: submit drops it, producing a general application
              // (evaluated against every open offer by rankings/matching).
              { value: 0, label: "🌐 Toutes les offres (candidature générale)" },
              ...(offers?.map((o) => ({ value: o.id, label: o.title })) ?? []),
            ]}
          />
        </Form.Item>
        <Form.Item name="motivation" label="Motivation (optionnel)">
          <Input.TextArea rows={2} />
        </Form.Item>

        <Form.Item
          name="cv"
          label="CV (PDF/DOCX, max 10 Mo)"
          valuePropName="fileList"
          getValueFromEvent={normFile}
          rules={[{ required: true, message: "Le CV est obligatoire" }]}
        >
          <Upload beforeUpload={() => false} maxCount={1} accept=".pdf,.docx">
            <Button icon={<UploadOutlined />}>Choisir le CV</Button>
          </Upload>
        </Form.Item>
      </Form>
    </Modal>
  );
}
