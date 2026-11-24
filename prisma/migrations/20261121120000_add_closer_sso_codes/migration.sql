CREATE TABLE `CloserSsoCode` (
    `tokenHash` VARCHAR(64) NOT NULL,
    `challenge` VARCHAR(43) NOT NULL,
    `redirectUri` VARCHAR(2048) NOT NULL,
    `userId` INTEGER NOT NULL,
    `sessionVersion` INTEGER NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `CloserSsoCode_expiresAt_idx`(`expiresAt`),
    INDEX `CloserSsoCode_userId_idx`(`userId`),
    PRIMARY KEY (`tokenHash`),
    CONSTRAINT `CloserSsoCode_userId_fkey`
        FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
