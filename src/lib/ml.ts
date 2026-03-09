import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase';

const functions = getFunctions(app, 'us-central1');

export async function mlGetAuthUrl(): Promise<string> {
  const fn = httpsCallable<void, { url: string }>(functions, 'mlGetAuthUrl');
  const result = await fn();
  return result.data.url;
}

export async function mlCheckAuth(): Promise<boolean> {
  const fn = httpsCallable<void, { authorized: boolean }>(functions, 'mlCheckAuth');
  const result = await fn();
  return result.data.authorized;
}

export async function mlPublish(productId: string): Promise<{ mlId: string; mlLink: string }> {
  const fn = httpsCallable<{ productId: string }, { mlId: string; mlLink: string }>(
    functions,
    'mlPublish',
  );
  const result = await fn({ productId });
  return result.data;
}

export async function mlToggle(
  productId: string,
  mlId: string,
  action: 'paused' | 'active',
): Promise<void> {
  const fn = httpsCallable(functions, 'mlToggle');
  await fn({ productId, mlId, action });
}

export async function mlUpdateListing(
  mlId: string,
  updates: { price?: number; description?: string },
): Promise<void> {
  const fn = httpsCallable(functions, 'mlUpdate');
  await fn({ mlId, ...updates });
}

export async function mlImportListings(): Promise<{ imported: number; skipped: number }> {
  const fn = httpsCallable<void, { imported: number; skipped: number }>(functions, 'mlImport');
  const result = await fn();
  return result.data;
}
