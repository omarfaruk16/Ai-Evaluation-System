-- CreateEnum
CREATE TYPE "LeadKind" AS ENUM ('pilot', 'demo', 'partner', 'contact');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('new', 'contacted', 'qualified', 'won', 'closed', 'spam');

-- CreateTable
CREATE TABLE "Lead" (
    "id" UUID NOT NULL,
    "kind" "LeadKind" NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "institution" TEXT,
    "website" TEXT,
    "role" TEXT,
    "country" TEXT,
    "size" TEXT,
    "message" TEXT NOT NULL,
    "sourcePage" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "note" TEXT,
    "contactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

