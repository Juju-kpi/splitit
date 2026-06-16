# Splitit — Bill Splitting App

A full-stack bill splitting app (like Tricount) with OCR receipt scanning and a training feedback loop to improve OCR accuracy over time.

## Stack

| Layer | Tech |
|---|---|
| Mobile | React Native + Expo (iOS & Android) |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL via Prisma ORM |
| Auth | JWT (access + refresh tokens) |
| OCR | Google Cloud Vision API (primary) + Tesseract.js fallback |
| OCR Training | PostgreSQL corrections table → periodic fine-tune pipeline |
| Storage | Supabase Storage (receipt images) |
| Push Notifications | Expo Notifications |

## Repository Structure

```
splitit/
├── app/              # React Native (Expo) mobile app
│   └── src/
│       ├── screens/  # Auth, Groups, Expenses, OCR flow
│       ├── components/
│       ├── hooks/
│       ├── services/ # API + OCR clients
│       ├── store/    # Zustand state management
│       ├── theme/    # Design tokens (matches your HTML prototype)
│       └── types/
├── backend/          # Express API
│   ├── src/
│   │   ├── routes/
│   │   ├── services/ # OCR, training, notifications
│   │   ├── middleware/
│   │   └── models/
│   └── prisma/       # Schema + migrations
└── shared/           # Shared TypeScript types
```

## Quick Start

### Prerequisites
- Node.js 20+
- PostgreSQL 15+
- Expo CLI: `npm install -g expo-cli`
- (Optional) Google Cloud Vision API key for production OCR

### 1. Backend
```bash
cd backend
cp .env.example .env        # fill in your values
npm install
npx prisma migrate dev
npm run dev                 # starts on :3001
```

### 2. Mobile App
```bash
cd app
cp .env.example .env        # set EXPO_PUBLIC_API_URL
npm install
npx expo start
```

Scan the QR code with Expo Go (iOS/Android) or run on simulator.

## Key Features

### OCR Flow
1. User photographs receipt
2. Image uploaded to Supabase Storage
3. Backend calls Google Vision (or Tesseract fallback)
4. Line items returned with confidence scores
5. User assigns items to group members
6. User can correct misread items inline
7. Corrections stored in `ocr_corrections` table with original OCR text, corrected text, confidence delta
8. Nightly job aggregates corrections → retraining signal

### OCR Training Loop
Every correction is stored:
```json
{
  "ocr_raw": "Ris0tto champi6nons",
  "ocr_price_raw": "24,0O",
  "corrected_name": "Risotto champignons",
  "corrected_price": 24.00,
  "confidence": 0.72,
  "vendor_hint": "La Stanza"
}
```
The `POST /api/ocr/correction` endpoint accepts these. A scheduled job (`backend/src/services/trainingPipeline.ts`) periodically:
- Aggregates low-confidence patterns
- Exports a JSONL fine-tune dataset
- Optionally calls OpenAI fine-tuning API or pushes to your own training infra

### Auth
- Email/password registration + login
- JWT access token (15min) + refresh token (30 days, stored in DB)
- Tokens stored in SecureStore on device

### Groups
- Create group, invite members by username or link
- Each member sets their display name in the group
- Expenses can be split equally or item-by-item (OCR flow)
- Balances computed server-side

## Environment Variables

### Backend (`backend/.env`)
```
DATABASE_URL=postgresql://user:pass@localhost:5432/splitit
JWT_SECRET=your-secret-here
JWT_REFRESH_SECRET=your-refresh-secret
GOOGLE_VISION_API_KEY=        # optional, falls back to Tesseract
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
PORT=3001
```

### App (`app/.env`)
```
EXPO_PUBLIC_API_URL=http://localhost:3001
```
