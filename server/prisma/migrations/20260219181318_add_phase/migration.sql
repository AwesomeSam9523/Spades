-- CreateEnum
CREATE TYPE "RoundPhase" AS ENUM ('CALLING', 'PLAYING', 'ENDED');

-- AlterTable
ALTER TABLE "Round" ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "phase" "RoundPhase" NOT NULL DEFAULT 'CALLING',
ADD COLUMN     "startedAt" TIMESTAMP(3);
