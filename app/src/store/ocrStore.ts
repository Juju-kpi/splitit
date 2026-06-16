// app/src/store/ocrStore.ts
// Manages the OCR scan flow state and queues corrections to the backend.
import { create } from 'zustand';
import { ocrApi } from '../services/api';
import { OcrItem } from '../../../shared/types';

export interface OcrItemState extends OcrItem {
  // who has selected this item (array of member IDs)
  assignedToMemberIds: string[];
  // user edited the name or price
  corrected: boolean;
  editing: boolean;
}

interface OcrStore {
  // Scan results
  items: OcrItemState[];
  rawText: string;
  scanConfidence: number;
  vendor: string | undefined;
  receiptImageUri: string | undefined;
  receiptImageUrl: string | undefined; // remote URL after upload
  isScanning: boolean;
  scanError: string | undefined;

  // Correction tracking
  pendingCorrections: number;
  totalCorrections: number;

  // Training stats (from server)
  trainingStats: {
    totalCorrections: number;
    totalReceipts: number;
    progressToNextRun: number;
    modelVersion: string;
  } | null;

  // Actions
  setScanning: (v: boolean) => void;
  setScanError: (e: string | undefined) => void;
  setScanResults: (result: {
    items: OcrItem[];
    rawText: string;
    confidence: number;
    vendor?: string;
    imageUri?: string;
    imageUrl?: string;
  }) => void;
  reset: () => void;

  toggleMember: (itemIndex: number, memberId: string) => void;
  startEdit: (itemIndex: number) => void;
  saveEdit: (itemIndex: number, name: string, price: number) => void;

  submitCorrections: (vendorHint?: string) => Promise<void>;
  loadTrainingStats: () => Promise<void>;
}

const DEFAULT_STATS = {
  totalCorrections: 0,
  totalReceipts: 0,
  progressToNextRun: 0,
  modelVersion: 'v1.0',
};

export const useOcrStore = create<OcrStore>((set, get) => ({
  items: [],
  rawText: '',
  scanConfidence: 0,
  vendor: undefined,
  receiptImageUri: undefined,
  receiptImageUrl: undefined,
  isScanning: false,
  scanError: undefined,
  pendingCorrections: 0,
  totalCorrections: 0,
  trainingStats: null,

  setScanning: (v) => set({ isScanning: v, scanError: undefined }),
  setScanError: (e) => set({ scanError: e, isScanning: false }),

  setScanResults: ({ items, rawText, confidence, vendor, imageUri, imageUrl }) => {
    const stateItems: OcrItemState[] = items.map(item => ({
      ...item,
      assignedToMemberIds: [],
      corrected: false,
      editing: false,
    }));
    set({
      items: stateItems,
      rawText,
      scanConfidence: confidence,
      vendor,
      receiptImageUri: imageUri,
      receiptImageUrl: imageUrl,
      isScanning: false,
      scanError: undefined,
      pendingCorrections: 0,
    });
  },

  reset: () => set({
    items: [],
    rawText: '',
    scanConfidence: 0,
    vendor: undefined,
    receiptImageUri: undefined,
    receiptImageUrl: undefined,
    isScanning: false,
    scanError: undefined,
    pendingCorrections: 0,
  }),

  toggleMember: (itemIndex, memberId) => {
    set(state => {
      const items = [...state.items];
      const item = { ...items[itemIndex] };
      const idx = item.assignedToMemberIds.indexOf(memberId);
      if (idx >= 0) {
        item.assignedToMemberIds = item.assignedToMemberIds.filter(id => id !== memberId);
      } else {
        item.assignedToMemberIds = [...item.assignedToMemberIds, memberId];
      }
      items[itemIndex] = item;
      return { items };
    });
  },

  startEdit: (itemIndex) => {
    set(state => ({
      items: state.items.map((item, i) => ({
        ...item,
        editing: i === itemIndex,
      })),
    }));
  },

  saveEdit: (itemIndex, name, price) => {
    set(state => {
      const items = [...state.items];
      const item = { ...items[itemIndex] };
      const nameChanged = name.trim() !== item.name;
      const priceChanged = price !== item.price;
      const changed = nameChanged || priceChanged;

      items[itemIndex] = {
        ...item,
        name: name.trim() || item.name,
        price: isNaN(price) ? item.price : price,
        corrected: changed,
        editing: false,
      };

      return {
        items,
        pendingCorrections: state.pendingCorrections + (changed ? 1 : 0),
      };
    });
  },

  submitCorrections: async (vendorHint) => {
    const { items } = get();
    const corrected = items.filter(item => item.corrected);
    if (corrected.length === 0) return;

    let submitted = 0;
    for (const item of corrected) {
      try {
        await ocrApi.saveCorrection({
          ocrRaw: item.ocrRaw,
          ocrPriceRaw: item.ocrPriceRaw,
          correctedName: item.name,
          correctedPrice: item.price,
          confidence: item.confidence,
          vendorHint: vendorHint || get().vendor,
          appVersion: '1.0.0',
        });
        submitted++;
      } catch (e) {
        console.error('[OCR] Failed to submit correction:', e);
      }
    }
    set(s => ({ totalCorrections: s.totalCorrections + submitted, pendingCorrections: 0 }));
  },

  loadTrainingStats: async () => {
    try {
      const stats = await ocrApi.getStats();
      set({ trainingStats: stats });
    } catch {
      set({ trainingStats: DEFAULT_STATS });
    }
  },
}));
