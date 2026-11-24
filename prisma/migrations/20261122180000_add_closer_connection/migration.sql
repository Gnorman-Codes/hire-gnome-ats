CREATE TABLE `CloserConnection` (
    `id` INTEGER NOT NULL,
    `userId` INTEGER NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `writesEnabled` BOOLEAN NOT NULL DEFAULT true,
    `ssoRedirectUri` VARCHAR(2048) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    INDEX `CloserConnection_userId_idx`(`userId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `CloserConnection_userId_fkey`
        FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
