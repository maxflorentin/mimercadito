import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase';

const functions = getFunctions(app, 'us-central1');

export interface AIParseResult {
  name: string;
  category: string;
  notes: string;
  condition: number;
}

export async function aiParseProduct(input: {
  text?: string;
  photoBase64?: string;
  photoMimeType?: string;
}): Promise<AIParseResult> {
  const fn = httpsCallable<typeof input, AIParseResult>(functions, 'aiParseProduct');
  const result = await fn(input);
  return result.data;
}
