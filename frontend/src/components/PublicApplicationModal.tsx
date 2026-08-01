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
  DatePicker,
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
import dayjs, { type Dayjs } from "dayjs";
import { useSubmitPublicApplication } from "@/api/hooks";
import { apiErrorMessage } from "@/api/client";
import type { PublicOffer } from "@/api/types";

const MAX_MB = 10;
const ACCEPT = ".pdf,.docx";
const EDUCATION_LEVELS = ["Bac+2", "Bac+3", "Bac+4", "Bac+5", "Doctorat"];
// 1–12 months: the range the booking period allows (see migration 0009).
const DURATIONS = [1, 2, 3, 4, 5, 6, 9, 12];

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
  // Requested internship period — what books the offer slot once assigned.
  start_date: z.custom<Dayjs>((v) => dayjs.isDayjs(v), "Date de début requise"),
  duration_months: z
    .number({ invalid_type_error: "Durée requise" })
    .int()
    .min(1)
    .max(12),
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
    watch,
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
      start_date: undefined,
      duration_months: undefined,
    },
  });

  const file = fileList[0]?.originFileObj;

  // Echo the resulting period back so the candidate sees the end date the
  // booking will use (the server derives it the same way).
  const startDate = watch("start_date");
  const durationMonths = watch("duration_months");
  const periodLabel =
    startDate && durationMonths
      ? `${startDate.format("DD/MM/YYYY")} → ${startDate
          .add(durationMonths, "month")
          .format("DD/MM/YYYY")}`
      : null;

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
    // Send the date only (no time/zone): the column is a DATE.
    fields.start_date = values.start_date.format("YYYY-MM-DD");
    fields.duration_months = values.duration_months;

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

        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item
              label="Début du stage"
              required
              validateStatus={errors.start_date ? "error" : ""}
              help={errors.start_date?.message as string | undefined}
            >
              <Controller
                name="start_date"
                control={control}
                render={({ field }) => (
                  <DatePicker
                    {...field}
                    style={{ width: "100%" }}
                    format="DD/MM/YYYY"
                    placeholder="Sélectionner une date"
                    // An internship can't start in the past.
                    disabledDate={(d) => d && d < dayjs().startOf("day")}
                  />
                )}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label="Durée du stage"
              required
              validateStatus={errors.duration_months ? "error" : ""}
              help={errors.duration_months?.message}
            >
              <Controller
                name="duration_months"
                control={control}
                render={({ field }) => (
                  <Select
                    {...field}
                    placeholder="Sélectionner"
                    options={DURATIONS.map((m) => ({
                      value: m,
                      label: `${m} mois`,
                    }))}
                  />
                )}
              />
            </Form.Item>
          </Col>
        </Row>
        {periodLabel && (
          <Typography.Paragraph type="secondary" style={{ marginTop: -12 }}>
            Période demandée : {periodLabel}
          </Typography.Paragraph>
        )}

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
