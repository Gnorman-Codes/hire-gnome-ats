ALTER TABLE `User` ADD COLUMN `serviceKey` VARCHAR(64) NULL;
CREATE UNIQUE INDEX `User_serviceKey_key` ON `User`(`serviceKey`);
