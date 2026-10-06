ALTER TABLE `SystemSetting`
 ADD COLUMN `aiMonthlyBudgetUsd` DECIMAL(12,6) NOT NULL DEFAULT 10,
 ADD COLUMN `aiEnabled` BOOLEAN NOT NULL DEFAULT true,
 ADD COLUMN `aiBudgetOverrideMonth` VARCHAR(7) NULL;
CREATE TABLE `AiUsageMonth` (
 `month` VARCHAR(7) NOT NULL,
 `spentUsd` DECIMAL(16,8) NOT NULL DEFAULT 0,
 `reservedUsd` DECIMAL(16,8) NOT NULL DEFAULT 0,
 `providerBlocked` BOOLEAN NOT NULL DEFAULT false,
 `updatedAt` DATETIME(3) NOT NULL,
 PRIMARY KEY (`month`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `AiUsageRequest` (
 `id` VARCHAR(36) NOT NULL,
 `month` VARCHAR(7) NOT NULL,
 `feature` VARCHAR(64) NOT NULL,
 `model` VARCHAR(128) NOT NULL,
 `status` VARCHAR(32) NOT NULL,
 `reservedUsd` DECIMAL(16,8) NOT NULL,
 `costUsd` DECIMAL(16,8) NOT NULL DEFAULT 0,
 `inputTokens` INTEGER NOT NULL DEFAULT 0,
 `cachedInputTokens` INTEGER NOT NULL DEFAULT 0,
 `outputTokens` INTEGER NOT NULL DEFAULT 0,
 `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 `completedAt` DATETIME(3) NULL,
 INDEX `AiUsageRequest_month_feature_idx` (`month`, `feature`),
 PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
