-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "Lane" AS ENUM ('realtime', 'deferred');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('accepted', 'adjusted', 'rejected');

-- CreateEnum
CREATE TYPE "LlmCallKind" AS ENUM ('marking', 'rubric_draft', 'feedback_rewrite');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('pending', 'delivered', 'failed');

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "apiKeyPrefix" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "webhookSecret" TEXT NOT NULL,
    "monthlyBudgetUsd" DECIMAL(12,4),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionContext" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "externalId" TEXT,
    "contentHash" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "modelAnswer" TEXT NOT NULL,
    "maxMarks" DOUBLE PRECISION NOT NULL,
    "markStep" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "rubric" JSONB NOT NULL,
    "rubricHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "groupId" TEXT,
    "externalId" TEXT NOT NULL,
    "answerText" TEXT NOT NULL,
    "answerHash" TEXT NOT NULL,
    "lane" "Lane" NOT NULL,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'queued',
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "callbackUrl" TEXT,
    "reusedFromId" TEXT,
    "suggestedScore" DOUBLE PRECISION,
    "maxMarks" DOUBLE PRECISION NOT NULL,
    "criteria" JSONB,
    "summary" TEXT,
    "strengths" TEXT[],
    "weaknesses" TEXT[],
    "highlights" JSONB,
    "missing" JSONB,
    "studentFeedback" JSONB,
    "confidence" DOUBLE PRECISION,
    "flags" TEXT[],
    "model" TEXT,
    "host" TEXT,
    "promptVersion" TEXT,
    "error" TEXT,
    "decision" "ReviewDecision",
    "finalScore" DOUBLE PRECISION,
    "finalCriteria" JSONB,
    "finalFeedback" JSONB,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmCall" (
    "id" BIGSERIAL NOT NULL,
    "clientId" TEXT NOT NULL,
    "evaluationId" TEXT,
    "kind" "LlmCallKind" NOT NULL,
    "model" TEXT NOT NULL,
    "host" TEXT,
    "promptVersion" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "reasoningTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Client_name_key" ON "Client"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Client_apiKeyHash_key" ON "Client"("apiKeyHash");

-- CreateIndex
CREATE INDEX "QuestionContext_clientId_externalId_idx" ON "QuestionContext"("clientId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionContext_clientId_contentHash_key" ON "QuestionContext"("clientId", "contentHash");

-- CreateIndex
CREATE INDEX "Evaluation_clientId_groupId_status_idx" ON "Evaluation"("clientId", "groupId", "status");

-- CreateIndex
CREATE INDEX "Evaluation_questionId_answerHash_idx" ON "Evaluation"("questionId", "answerHash");

-- CreateIndex
CREATE INDEX "Evaluation_clientId_updatedAt_idx" ON "Evaluation"("clientId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_clientId_questionId_externalId_key" ON "Evaluation"("clientId", "questionId", "externalId");

-- CreateIndex
CREATE INDEX "LlmCall_clientId_createdAt_idx" ON "LlmCall"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "LlmCall_evaluationId_idx" ON "LlmCall"("evaluationId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_clientId_status_idx" ON "WebhookDelivery"("clientId", "status");

-- CreateIndex
CREATE INDEX "WebhookDelivery_evaluationId_idx" ON "WebhookDelivery"("evaluationId");

-- AddForeignKey
ALTER TABLE "QuestionContext" ADD CONSTRAINT "QuestionContext_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuestionContext"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmCall" ADD CONSTRAINT "LlmCall_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

