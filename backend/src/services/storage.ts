// backend/src/services/storage.ts
import { createClient } from '@supabase/supabase-js';
import { v4 as uuid } from 'uuid';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key);
}

export async function uploadReceiptImage(
  buffer: Buffer,
  mimeType: string,
  userId: string
): Promise<string> {
  const supabase = getSupabase();
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const key = `receipts/${userId}/${uuid()}.${ext}`;

  const { error } = await supabase.storage
    .from('receipts')
    .upload(key, buffer, { contentType: mimeType, upsert: false });

  if (error) throw error;

  const { data } = supabase.storage.from('receipts').getPublicUrl(key);
  return data.publicUrl;
}

export async function deleteReceiptImage(key: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.storage.from('receipts').remove([key]);
}
