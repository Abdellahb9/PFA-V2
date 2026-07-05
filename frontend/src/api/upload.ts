// Application submission flow (serverless): signed upload URL -> upload the CV
// directly to Supabase Storage -> create the application via the function.
import { supabase, STORAGE_BUCKET } from "@/lib/supabase";
import { api } from "./client";
import type { ApplicationSubmitResult } from "./types";

export async function submitApplicationViaStorage(
  fields: Record<string, unknown>,
  file: File,
): Promise<ApplicationSubmitResult> {
  const { data: up } = await api.post<{ path: string; token: string }>("/create-upload-url", {
    filename: file.name,
  });
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .uploadToSignedUrl(up.path, up.token, file);
  if (error) throw error;
  const { data } = await api.post<ApplicationSubmitResult>("/submit-application", {
    ...fields,
    cv: { path: up.path, filename: file.name, content_type: file.type, size: file.size },
  });
  return data;
}

export interface BulkSubmitResult {
  created: { application_id: number; filename: string }[];
  errors: { filename: string; detail: string }[];
}

// Bulk import (staff): upload every CV to storage, then create one application
// per file in a single call; identity is extracted from the CV by the analyzer.
export async function submitApplicationsBulkViaStorage(
  files: File[],
  offerId?: number | null,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkSubmitResult> {
  const cvs: { path: string; filename: string; content_type: string; size: number }[] = [];
  let done = 0;
  for (const file of files) {
    const { data: up } = await api.post<{ path: string; token: string }>("/create-upload-url", {
      filename: file.name,
    });
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .uploadToSignedUrl(up.path, up.token, file);
    if (error) throw error;
    cvs.push({ path: up.path, filename: file.name, content_type: file.type, size: file.size });
    onProgress?.(++done, files.length);
  }
  const { data } = await api.post<BulkSubmitResult>("/submit-application-bulk", {
    cvs,
    offer_id: offerId ?? null,
  });
  return data;
}
