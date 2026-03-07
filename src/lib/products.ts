import {
  collection,
  addDoc,
  updateDoc,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, auth } from './firebase';
import type { Product } from './types';

const productsRef = collection(db, 'products');

export function subscribeProducts(
  status: 'available' | 'sold' | 'archived',
  callback: (products: Product[]) => void,
): Unsubscribe {
  const q = query(
    productsRef,
    where('status', '==', status),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(q, (snap) => {
    const products = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Product);
    callback(products);
  });
}

export async function addProduct(
  data: Omit<Product, 'id' | 'createdAt' | 'createdBy' | 'createdByEmail'>,
): Promise<string> {
  const user = auth.currentUser!;
  const docRef = await addDoc(productsRef, {
    ...data,
    createdAt: Timestamp.now(),
    createdBy: user.uid,
    createdByEmail: user.email || '',
  });
  return docRef.id;
}

export async function updateProduct(id: string, data: Partial<Product>): Promise<void> {
  await updateDoc(doc(db, 'products', id), data);
}

export async function markSold(id: string, salePrice: number): Promise<void> {
  await updateDoc(doc(db, 'products', id), {
    status: 'sold',
    salePrice,
    saleDate: Timestamp.now(),
  });
}

export async function archiveProduct(id: string): Promise<void> {
  await updateDoc(doc(db, 'products', id), { status: 'archived' });
}

export async function reactivateProduct(id: string): Promise<void> {
  await updateDoc(doc(db, 'products', id), { status: 'available' });
}

export async function uploadProductPhoto(file: File, productId: string): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg';
  const storageRef = ref(storage, `products/${productId}.${ext}`);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}
