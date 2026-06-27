ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pushToken" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notifExpense" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notifReminder" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "supabaseId" TEXT UNIQUE;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "resetToken" TEXT UNIQUE;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "resetTokenExpiry" TIMESTAMP(3);

-- Vérification
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'users' 
ORDER BY column_name;