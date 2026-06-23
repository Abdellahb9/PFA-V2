// Public application modal (landing page): a visitor applies to an offer by
// uploading a CV — no authentication. Validation with React Hook Form + Zod
// (text fields) and AntD Upload (file type/size), aligned with the backend
// Pydantic/Form schema of POST /api/v1/applications.
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Button,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Typography,
  Upload,
  message,
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { UploadFile } from "antd";
import { useSubmitPublicApplication } from "@/api/hooks";
import { apiErrorMessage } from "@/api/client";
import type { PublicOffer } from "@/api/types";

const MAX_MB = 10;
const ACCEPT = ".pdf,.docx";
const EDUCATION_LEVELS = ["Bac+2", "Bac+3", "Bac+4", "Bac+5", "Doctorat"];

const schema = z.object({
  first_name: z.string().min(1, "Prénom requis"),
  last_name: z.string().min(1, "Nom requis"),
  email: z.string().email("Adresse email invalide"),
  phone: z
    .string()
    .min(1, "Téléphone requis")
    .regex(/^\+?[0-9\s().-]{6,}$/, "Numéro invalide (chiffres uniquement)"),
  field_of_study: z.string().optional(),
  education_level: z.string().optional(),
  motivation: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  offer: PublicOffer | null;
  onClose: () => void;
}

export default function PublicApplicationModal({ open, offer, onClose }: Props) {
  const submit = useSubmitPublicApplication();
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      field_of_study: "",
      education_level: undefined,
      motivation: "",
    },
  });

  const file = fileList[0]?.originFileObj;

  // Client-side validation: PDF/DOCX only, max 10 MB (server re-validates).
  const beforeUpload = (f: File) => {
    const okType = /\.(pdf|docx)$/i.test(f.name);
    const okSize = f.size <= MAX_MB * 1024 * 1024;
    if (!okType) {
      message.error("Format non supporté : PDF ou DOCX uniquement");
      return Upload.LIST_IGNORE;
    }
    if (!okSize) {
      message.error(`Fichier trop volumineux (max ${MAX_MB} Mo)`);
      return Upload.LIST_IGNORE;
    }
    return false; // keep the file locally, no auto-upload
  };

  const handleClose = () => {
    reset();
    setFileList([]);
    onClose();
  };

  const onSubmit = async (values: FormValues) => {
    if (!file) {
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
    if (values.motivation) fields.motivation = values.motivation;
    if (offer) fields.offer_id = offer.id;

    try {
      await submit.mutateAsync({ fields, file });
      message.success(
        "Candidature envoyée ! Créez un compte avec cet email pour suivre son avancement.",
        6,
      );
      handleClose();
    } catch (err) {
      message.error(apiErrorMessage(err, "Échec de l'envoi de la candidature"));
    }
  };

  return (
    <Modal
      open={open}
      title={offer ? `Postuler — ${offer.title}` : "Postuler"}
      onOk={handleSubmit(onSubmit)}
      onCancel={handleClose}
      okText="Envoyer ma candidature"
      cancelText="Annuler"
      confirmLoading={submit.isPending}
      width={560}
      forceRender
    >
      {offer && (
        <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
          {offer.department_name}
          {offer.field ? ` · ${offer.field}` : ""}
        </Typography.Paragraph>
      )}

      <Form layout="vertical" onFinish={handleSubmit(onSubmit)}>
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item
              label="Prénom"
              required
              validateStatus={errors.first_name ? "error" : ""}
              help={errors.first_name?.message}
            >
              <Controller
                name="first_name"
                control={control}
                render={({ field }) => <Input {...field} placeholder="Youssef" />}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label="Nom"
              required
              validateStatus={errors.last_name ? "error" : ""}
              help={errors.last_name?.message}
            >
              <Controller
                name="last_name"
                control={control}
                render={({ field }) => <Input {...field} placeholder="El Khattabi" />}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item
              label="Email"
              required
              validateStatus={errors.email ? "error" : ""}
              help={errors.email?.message}
            >
              <Controller
                name="email"
                control={control}
                render={({ field }) => (
                  <Input {...field} placeholder="vous@example.ma" autoComplete="email" />
                )}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label="Téléphone"
              required
              validateStatus={errors.phone ? "error" : ""}
              help={errors.phone?.message}
            >
              <Controller
                name="phone"
                control={control}
                render={({ field }) => (
                  <Input
                    {...field}
                    inputMode="tel"
                    placeholder="+212 6 12 34 56 78"
                    // Keep only digits and phone separators (no letters).
                    onChange={(e) =>
                      field.onChange(e.target.value.replace(/[^\d+\s().-]/g, ""))
                    }
                  />
                )}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item label="Filière">
              <Controller
                name="field_of_study"
                control={control}
                render={({ field }) => <Input {...field} placeholder="Informatique" />}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item label="Niveau d'études">
              <Controller
                name="education_level"
                control={control}
                render={({ field }) => (
                  <Select
                    {...field}
                    allowClear
                    placeholder="Sélectionner"
                    options={EDUCATION_LEVELS.map((v) => ({ value: v, label: v }))}
                  />
                )}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item label="Motivation (optionnel)">
          <Controller
            name="motivation"
            control={control}
            render={({ field }) => (
              <Input.TextArea {...field} rows={2} maxLength={4000} showCount />
            )}
          />
        </Form.Item>

        <Form.Item label={`CV (PDF ou DOCX, max ${MAX_MB} Mo)`} required>
          <Upload
            beforeUpload={beforeUpload}
            fileList={fileList}
            onChange={({ fileList: fl }) => setFileList(fl.slice(-1))}
            maxCount={1}
            accept={ACCEPT}
          >
            <Button icon={<UploadOutlined />}>Choisir le CV</Button>
          </Upload>
        </Form.Item>
      </Form>
    </Modal>
  );
}
