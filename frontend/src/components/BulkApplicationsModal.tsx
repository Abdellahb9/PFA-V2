// Modal to import several CVs at once: one application is created per file and
// the candidate identity (name, email…) is extracted automatically from the CV.
import { useState } from "react";
import { Modal, Upload, Select, Button, message, Alert, Progress, Space } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import type { UploadFile } from "antd";
import { useOffers, useBulkSubmitApplications } from "@/api/hooks";
import { apiErrorMessage } from "@/api/client";

const MAX_FILES = 20;

// Sentinel for the explicit "all offers" choice: stored as a general
// application (offer_id null), which the rankings/matching evaluate against
// every open offer.
const ALL_OFFERS = 0;

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function BulkApplicationsModal({ open, onClose }: Props) {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [offerId, setOfferId] = useState<number | undefined>();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const { data: offers } = useOffers();
  const bulkSubmit = useBulkSubmitApplications();

  const reset = () => {
    setFileList([]);
    setOfferId(undefined);
    setProgress(null);
  };

  const onSubmit = async () => {
    // beforeUpload pushes the raw RcFile (which extends File) into the list.
    const files = fileList
      .map((f) => (f.originFileObj ?? f) as unknown as File)
      .filter((f) => f instanceof File);
    if (!files.length) {
      message.error("Ajoutez au moins un CV");
      return;
    }
    try {
      const result = await bulkSubmit.mutateAsync({
        files,
        // ALL_OFFERS (0) and "no choice" both mean a general application.
        offerId: offerId || null,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      message.success(
        `${result.created.length} candidature(s) créée(s) — analyse des CV en cours…`,
      );
      for (const err of result.errors) {
        message.warning(`${err.filename} : ${err.detail}`);
      }
      reset();
      onClose();
    } catch (err) {
      setProgress(null);
      message.error(apiErrorMessage(err, "Échec de l'import"));
    }
  };

  return (
    <Modal
      title="Importer des CV en lot"
      open={open}
      onOk={onSubmit}
      onCancel={() => {
        reset();
        onClose();
      }}
      okText={`Importer${fileList.length ? ` (${fileList.length})` : ""}`}
      cancelText="Annuler"
      okButtonProps={{ disabled: !fileList.length }}
      confirmLoading={bulkSubmit.isPending}
      width={560}
      destroyOnClose
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Alert
          type="info"
          showIcon
          message="Une candidature est créée par CV. Le nom, l'email et les compétences du candidat sont extraits automatiquement du document."
        />
        <Upload.Dragger
          multiple
          accept=".pdf,.docx"
          fileList={fileList}
          beforeUpload={(file) => {
            setFileList((prev) => {
              if (prev.length >= MAX_FILES) {
                message.warning(`Maximum ${MAX_FILES} fichiers par import`);
                return prev;
              }
              if (prev.some((p) => p.name === file.name && p.size === file.size)) {
                return prev;
              }
              return [...prev, file as unknown as UploadFile];
            });
            return false;
          }}
          onRemove={(file) => {
            setFileList((prev) => prev.filter((f) => f.uid !== file.uid));
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">Glissez-déposez les CV ici, ou cliquez pour choisir</p>
          <p className="ant-upload-hint">
            PDF ou DOCX, max 10 Mo par fichier, {MAX_FILES} fichiers max
          </p>
        </Upload.Dragger>
        <Select
          allowClear
          placeholder="Offre visée (optionnel — candidature générale sinon)"
          style={{ width: "100%" }}
          value={offerId}
          onChange={setOfferId}
          options={[
            {
              value: ALL_OFFERS,
              label: "🌐 Toutes les offres (candidature générale)",
            },
            ...(offers?.map((o) => ({ value: o.id, label: o.title })) ?? []),
          ]}
        />
        {progress && bulkSubmit.isPending && (
          <Progress
            percent={Math.round((progress.done / progress.total) * 100)}
            format={() => `${progress.done}/${progress.total} CV envoyés`}
          />
        )}
        {fileList.length > 0 && !bulkSubmit.isPending && (
          <Button size="small" onClick={() => setFileList([])}>
            Vider la liste
          </Button>
        )}
      </Space>
    </Modal>
  );
}
