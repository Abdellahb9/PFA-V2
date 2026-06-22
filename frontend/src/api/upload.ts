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
