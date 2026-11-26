CREATE TABLE `IntegrationApiCredential` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `recordId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `userId` INTEGER NOT NULL,
    `divisionId` INTEGER NOT NULL,
    `role` ENUM('ADMINISTRATOR', 'DIRECTOR', 'RECRUITER') NOT NULL,
    `writesEnabled` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    UNIQUE INDEX `IntegrationApiCredential_recordId_key`(`recordId`),
    UNIQUE INDEX `IntegrationApiCredential_tokenHash_key`(`tokenHash`),
    INDEX `IntegrationApiCredential_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `IntegrationApiCredential` ADD CONSTRAINT `IntegrationApiCredential_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
