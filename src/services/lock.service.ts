import { ConstantsService } from './constants.service';

import { CipherService } from '../abstractions/cipher.service';
import { CollectionService } from '../abstractions/collection.service';
import { CryptoService } from '../abstractions/crypto.service';
import { FolderService } from '../abstractions/folder.service';
import { LockService as LockServiceAbstraction } from '../abstractions/lock.service';
import { MessagingService } from '../abstractions/messaging.service';
import { PlatformUtilsService } from '../abstractions/platformUtils.service';
import { SearchService } from '../abstractions/search.service';
import { StorageService } from '../abstractions/storage.service';

export class LockService implements LockServiceAbstraction {
    pinLocked = false;

    private inited = false;
    private reloadInterval: any = null;

    constructor(private cipherService: CipherService, private folderService: FolderService,
        private collectionService: CollectionService, private cryptoService: CryptoService,
        private platformUtilsService: PlatformUtilsService, private storageService: StorageService,
        private messagingService: MessagingService, private searchService: SearchService,
        private lockedCallback: () => Promise<void> = null, private reloadCallback: () => Promise<void> = null) {
    }

    init(checkOnInterval: boolean) {
        if (this.inited) {
            return;
        }

        this.inited = true;
        if (checkOnInterval) {
            this.checkLock();
            setInterval(() => this.checkLock(), 10 * 1000); // check every 10 seconds
        }
    }

    async isLocked(): Promise<boolean> {
        const hasKey = await this.cryptoService.hasKey();
        if (hasKey && this.pinLocked) {
            return true;
        }
        return !hasKey;
    }

    async checkLock(): Promise<void> {
        if (this.platformUtilsService.isViewOpen()) {
            // Do not lock
            return;
        }

        if (await this.isLocked()) {
            return;
        }

        let lockOption = this.platformUtilsService.lockTimeout();
        if (lockOption == null) {
            lockOption = await this.storageService.get<number>(ConstantsService.lockOptionKey);
        }
        if (lockOption == null || lockOption < 0) {
            return;
        }

        const lastActive = await this.storageService.get<number>(ConstantsService.lastActiveKey);
        if (lastActive == null) {
            return;
        }

        const lockOptionSeconds = lockOption * 60;
        const diffSeconds = ((new Date()).getTime() - lastActive) / 1000;
        if (diffSeconds >= lockOptionSeconds) {
            // need to lock now
            await this.lock(true);
        }
    }

    async lock(allowSoftLock = false): Promise<void> {
        if (allowSoftLock) {
            const pinSet = await this.isPinLockSet();
            if (pinSet[0]) {
                this.pinLocked = true;
                this.messagingService.send('locked');
                if (this.lockedCallback != null) {
                    await this.lockedCallback();
                }
                return;
            }
        }

        await Promise.all([
            this.cryptoService.clearKey(),
            this.cryptoService.clearOrgKeys(true),
            this.cryptoService.clearKeyPair(true),
            this.cryptoService.clearEncKey(true),
        ]);

        this.folderService.clearCache();
        this.cipherService.clearCache();
        this.collectionService.clearCache();
        this.searchService.clearIndex();
        this.messagingService.send('locked');
        if (this.lockedCallback != null) {
            await this.lockedCallback();
        }
    }

    async setLockOption(lockOption: number): Promise<void> {
        await this.storageService.save(ConstantsService.lockOptionKey, lockOption);
        await this.cryptoService.toggleKey();
    }

    async isPinLockSet(): Promise<[boolean, boolean]> {
        const protectedPin = await this.storageService.get<string>(ConstantsService.protectedPin);
        const pinProtectedKey = await this.storageService.get<string>(ConstantsService.pinProtectedKey);
        return [protectedPin != null, pinProtectedKey != null];
    }

    clear(): Promise<any> {
        return this.storageService.remove(ConstantsService.protectedPin);
    }

    startLockReload(): void {
        if (this.pinLocked || this.reloadInterval != null) {
            return;
        }
        this.reloadInterval = setInterval(async () => {
            let doRefresh = false;
            const lastActive = await this.storageService.get<number>(ConstantsService.lastActiveKey);
            if (lastActive != null) {
                const diffSeconds = (new Date()).getTime() - lastActive;
                // Don't refresh if they are still active in the window
                doRefresh = diffSeconds >= 5000;
            }
            if (doRefresh) {
                clearInterval(this.reloadInterval);
                this.reloadInterval = null;
                this.messagingService.send('reloadProcess');
                if (this.reloadCallback != null) {
                    await this.reloadCallback();
                }
            }
        }, 10000);
    }

    cancelLockReload(): void {
        if (this.reloadInterval != null) {
            clearInterval(this.reloadInterval);
            this.reloadInterval = null;
        }
    }
}
