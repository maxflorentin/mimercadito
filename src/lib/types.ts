import { Timestamp } from 'firebase/firestore';

export interface Product {
  id: string;
  name: string;
  category: string;
  condition: number;
  costPrice: number;
  listPrice: number;
  floorPrice: number;
  notes: string;
  photoUrl: string;
  status: 'available' | 'sold' | 'archived';
  salePrice?: number;
  saleDate?: Timestamp;
  mlId?: string;
  mlLink?: string;
  mlStatus?: 'active' | 'paused' | 'closed' | null;
  mlCategoryId?: string;
  mlAttributes?: Record<string, unknown>[];
  mlDescription?: string;
  mlReadyToPublish?: boolean;
  slideObjectId?: string;
  createdAt: Timestamp;
  createdBy: string;
  createdByEmail: string;
  parsedFrom?: string;
}

export const CATEGORIES = [
  'Electronics',
  'Fashion',
  'Home',
  'Sports',
  'Toys',
  'Books',
  'Tools',
  'Auto',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];
