// shared/types.ts

export interface User {
  id: string;
  email: string;
  username: string;
  avatarColor: string;
  createdAt: string;
  // Notifications
  pushToken?: string | null;
  webPushToken?: string | null;
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

// Un remboursement : X verse un montant a Y, avec l'accord des deux.
// Independant des depenses — c'est ce qui permet de solder un solde ne d'une
// compensation en chaine, qu'aucune part de depense ne relie directement.
export interface Settlement {
  id: string;
  groupId: string;
  fromMemberId: string;
  fromMember?: GroupMember;
  toMemberId: string;
  toMember?: GroupMember;
  amount: number;
  currency: string;
  method?: string | null;
  note?: string | null;
  /** Confirmations cote a cote — les soldes ne bougent qu'avec les deux. */
  confirmedByFromAt?: string | null;
  confirmedByToAt?: string | null;
  confirmed: boolean;
  confirmedAt?: string | null;
  /** Annulation douce : reste dans l'historique, sort des soldes. */
  cancelledAt?: string | null;
  cancelledByMemberId?: string | null;
  createdByMemberId?: string | null;
  createdBy?: GroupMember | null;
  createdAt: string;
}

/**
 * Le detail du calcul pour une personne, ligne a ligne :
 *   net = paid − share + settledOwn − settledAsPayer
 *             + settlementsPaid − settlementsReceived
 * La somme des `net` du groupe vaut toujours 0.
 */
export interface NetBreakdown {
  /** Ce qu'il a avance de sa poche, toutes depenses confondues. */
  paid: number;
  /** Sa part totale, qu'elle soit reglee ou non. */
  share: number;
  /** Celles de ses parts deja marquees reglees : il ne les doit plus. */
  settledOwn: number;
  /** Parts reglees dont il etait le payeur : son credit disparait d'autant. */
  settledAsPayer: number;
  /** Remboursements confirmes qu'il a verses. */
  settlementsPaid: number;
  /** Remboursements confirmes qu'il a recus. */
  settlementsReceived: number;
  /** Positif = on lui doit encore ; negatif = il doit. */
  net: number;
}

/**
 * Reponse de GET /api/groups/:id — le groupe, ses soldes nettes et la position
 * de chaque membre. `netByMember` est calcule par le serveur : positif = on lui
 * doit encore, negatif = il doit. Le recalculer cote client reviendrait a
 * oublier les remboursements.
 */
export interface GroupDetail extends Group {
  balances: Balance[];
  settlements?: Settlement[];
  netByMember?: Record<string, number>;
  netBreakdown?: Record<string, NetBreakdown>;
}

export interface CreateSettlementInput {
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  amount: number;
  currency?: string;
  method?: string;
  note?: string;
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