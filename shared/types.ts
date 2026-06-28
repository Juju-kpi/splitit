// shared/types.ts

export interface User {
  id: string;
  email: string;
  username: string;
  avatarColor: string;
  createdAt: string;
  // Notifications
  pushToken?: string | null;
  notifExpense?: boolean;
  notifReminder?: boolean;
  // Préférences
  preferredLanguage?: string;
  preferredCurrency?: string;
}

export interface Group {
  id: string;
  name: string;
  emoji: string;
  createdAt: string;
  members: GroupMember[];
  expenseCount: number;
}

export interface GroupMember {
  id: string;
  userId: string;
  groupId: string;
  displayName: string;
  avatarColor: string;
  avatarInitials: string;
  joinedAt: string;
}

// One entry per payer on a given expense
export interface ExpensePayment {
  id: string;
  expenseId: string;
  memberId: string;
  member?: GroupMember;
  amount: number;
}

export interface Expense {
  id: string;
  groupId: string;
  description: string;
  totalAmount: number;
  currency: string;
  note?: string;
  isComplete?: boolean;
  /** @deprecated use payments[] — kept for backward compat */
  paidByMemberId: string;
  /** Who paid and how much — may have multiple entries */
  payments: ExpensePayment[];
  splitType: 'EQUAL' | 'ITEMIZED' | 'CUSTOM';
  receiptImageUrl?: string;
  ocrConfidence?: number;
  items: ExpenseItem[];
  splits: ExpenseSplit[];
  createdAt: string;
}

export interface ExpenseItem {
  id: string;
  expenseId: string;
  name: string;
  price: number;
  ocrRaw?: string;
  ocrConfidence?: number;
  corrected: boolean;
  assignedTo: string[];
}

export interface ExpenseSplit {
  id: string;
  expenseId: string;
  memberId: string;
  member?: GroupMember;
  amount: number;
  settled: boolean;
}

export interface Balance {
  fromMemberId: string;
  fromMember: GroupMember;
  toMemberId: string;
  toMember: GroupMember;
  amount: number;
}

export interface OcrResult {
  items: OcrItem[];
  rawText: string;
  confidence: number;
  vendor?: string;
}

export interface OcrItem {
  name: string;
  price: number;
  ocrRaw: string;
  ocrPriceRaw: string;
  confidence: number;
}

export interface OcrCorrection {
  receiptId: string;
  itemIndex: number;
  ocrRaw: string;
  ocrPriceRaw: string;
  correctedName: string;
  correctedPrice: number;
  confidence: number;
  vendorHint?: string;
}

export interface ApiResponse<T> {
  data: T;
  error?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface CreateExpenseInput {
  groupId: string;
  description: string;
  totalAmount: number;
  currency?: string;
  /** Single-payer shortcut — ignored when payments[] is set */
  paidByMemberId?: string;
  /** Multi-payer: who paid and how much */
  payments?: { memberId: string; amount: number }[];
  splitType: 'EQUAL' | 'ITEMIZED' | 'CUSTOM';
  splitMemberIds?: string[];
  customSplits?: { memberId: string; amount: number }[];
  receiptImageUrl?: string;
  ocrConfidence?: number;
  items?: {
    name: string;
    price: number;
    ocrRaw?: string;
    ocrConfidence?: number;
    corrected: boolean;
    assignedToMemberIds: string[];
  }[];
}