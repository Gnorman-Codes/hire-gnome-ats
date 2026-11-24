CREATE TABLE `SyncedActivityNoteChange` (
    `recordId` VARCHAR(80) NOT NULL,
    `summary` TEXT NULL,
    `changedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`recordId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
