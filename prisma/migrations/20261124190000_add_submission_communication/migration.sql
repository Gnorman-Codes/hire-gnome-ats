CREATE TABLE `SubmissionCommunication` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `submissionId` INTEGER NOT NULL,
    `requestId` VARCHAR(36) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `deliveryStatus` VARCHAR(20) NULL,
    `contactName` VARCHAR(191) NULL,
    `recipientEmail` VARCHAR(254) NULL,
    `replyTo` VARCHAR(254) NULL,
    `subject` VARCHAR(200) NULL,
    `body` TEXT NOT NULL,
    `actorUserId` INTEGER NULL,
    `actorName` VARCHAR(191) NOT NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SubmissionCommunication_submissionId_requestId_key`(`submissionId`, `requestId`),
    INDEX `SubmissionCommunication_submissionId_createdAt_idx`(`submissionId`, `createdAt`),
    INDEX `SubmissionCommunication_actorUserId_idx`(`actorUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SubmissionCommunication` ADD CONSTRAINT `SubmissionCommunication_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `Submission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `SubmissionCommunication` ADD CONSTRAINT `SubmissionCommunication_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
