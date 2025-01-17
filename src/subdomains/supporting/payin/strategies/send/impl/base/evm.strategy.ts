import { PayInEvmService } from 'src/subdomains/supporting/payin/services/base/payin-evm.service';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { SendGroup, SendGroupKey, SendStrategy, SendType } from './send.strategy';
import { CryptoInput, PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { Util } from 'src/shared/utils/util';
import { Config } from 'src/config/config';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';
import { DfxLogger, LogLevel } from 'src/shared/services/dfx-logger';
import { FeeLimitExceededException } from 'src/shared/payment/exceptions/fee-limit-exceeded.exception';
import { TransactionHelper } from 'src/shared/payment/services/transaction-helper';

export abstract class EvmStrategy extends SendStrategy {
  protected readonly logger = new DfxLogger(EvmStrategy);

  constructor(
    protected readonly payInEvmService: PayInEvmService,
    protected readonly payInRepo: PayInRepository,
    protected readonly blockchain: Blockchain,
    priceProvider: PriceProviderService,
    payoutService: PayoutService,
    transactionHelper: TransactionHelper,
  ) {
    super(priceProvider, payoutService, transactionHelper);
  }

  protected abstract dispatchSend(payInGroup: SendGroup, estimatedNativeFee: number): Promise<string>;
  protected abstract prepareSend(payInGroup: SendGroup, estimatedNativeFee: number): Promise<void>;
  protected abstract checkPreparation(payInGroup: SendGroup): Promise<boolean>;

  async doSend(payIns: CryptoInput[], type: SendType): Promise<void> {
    this.logInput(payIns, type);

    const groups = this.groupPayIns(payIns, type);

    for (const payInGroup of [...groups.values()]) {
      try {
        if (payInGroup.status === PayInStatus.PREPARING) {
          const isReady = await this.checkPreparation(payInGroup);

          if (isReady) {
            payInGroup.status = PayInStatus.PREPARED;
          } else {
            continue;
          }
        }

        if ([PayInStatus.ACKNOWLEDGED, PayInStatus.TO_RETURN].includes(payInGroup.status)) {
          const { nativeFee, targetFee } = await this.getEstimatedFee(payInGroup.asset);
          const minInputFee = await this.getMinInputFee(payInGroup.asset);

          CryptoInput.verifyEstimatedFee(targetFee, minInputFee, this.getTotalGroupAmount(payInGroup));

          /**
           * @note
           * setting to some default minimal amount in case estimated fees go very low.
           */
          const effectivePreparationFee = Math.max(nativeFee, Config.blockchain.evm.minimalPreparationFee);

          await this.prepareSend(payInGroup, effectivePreparationFee);

          continue;
        }

        if (payInGroup.status === PayInStatus.PREPARED) {
          await this.dispatch(payInGroup, type, this.getTotalSendFee(payInGroup));

          continue;
        }
      } catch (e) {
        const logLevel = e instanceof FeeLimitExceededException ? LogLevel.INFO : LogLevel.ERROR;

        this.logger.log(
          logLevel,
          `Failed to send ${this.blockchain} input(s) ${this.getPayInsIdentityKey(payInGroup)} of type ${type}:`,
          e,
        );

        continue;
      }
    }
  }

  async checkConfirmations(payIns: CryptoInput[]): Promise<void> {
    /**
     * @autoconfirm
     */
    for (const payIn of payIns) {
      try {
        payIn.confirm();
        await this.payInRepo.save(payIn);
      } catch (e) {
        this.logger.error(`Failed to check confirmations of ${this.blockchain} input ${payIn.id}:`, e);
      }
    }
  }

  //*** HELPER METHODS ***//

  private logInput(payIns: CryptoInput[], type: SendType): void {
    const newPayIns = payIns.filter((p) => p.status !== PayInStatus.PREPARING);

    newPayIns.length > 0 &&
      this.logger.verbose(
        `${type === SendType.FORWARD ? 'Forwarding' : 'Returning'} ${newPayIns.length} ${this.blockchain} ${
          payIns[0].asset.type
        } input(s): ${newPayIns.map((p) => p.id)}`,
      );
  }

  private groupPayIns(payIns: CryptoInput[], type: SendType): Map<SendGroupKey, SendGroup> {
    const groups = new Map<SendGroupKey, SendGroup>();

    for (const payIn of payIns) {
      this.designateSend(payIn, type);

      const { address, destinationAddress, asset, status } = payIn;

      const group = groups.get(this.getPayInGroupKey(payIn));

      if (!group) {
        groups.set(this.getPayInGroupKey(payIn), {
          sourceAddress: address.address,
          account: Config.blockchain.evm.walletAccount(payIn.route.deposit.accountIndex),
          destinationAddress: destinationAddress.address,
          asset,
          status,
          payIns: [payIn],
        });

        continue;
      }

      group.payIns.push(payIn);
    }

    return groups;
  }

  private getPayInGroupKey(payIn: CryptoInput): SendGroupKey {
    return `${payIn.address.address}&${payIn.destinationAddress.address}&&${payIn.asset.dexName}&${payIn.asset.type}&${payIn.status}`;
  }

  private getPayInsIdentityKey(payInGroup: SendGroup): string {
    return payInGroup.payIns.reduce((acc, t) => acc + `|${t.id}|`, '');
  }

  protected getTotalGroupAmount(payInGroup: SendGroup): number {
    return Util.sumObj<CryptoInput>(payInGroup.payIns, 'amount');
  }

  protected getTotalSendFee(payInGroup: SendGroup): number {
    return Util.sumObj<CryptoInput>(payInGroup.payIns, 'forwardFeeAmount');
  }

  protected topUpCoin(payInGroup: SendGroup, amount: number): Promise<string> {
    const { sourceAddress } = payInGroup;

    return this.payInEvmService.sendNativeCoinFromDex(sourceAddress, amount);
  }

  private async dispatch(payInGroup: SendGroup, type: SendType, estimatedNativeFee: number): Promise<void> {
    const outTxId = await this.dispatchSend(payInGroup, estimatedNativeFee);

    const updatedPayIns = this.updatePayInsWithSendData(payInGroup, outTxId, type);

    await this.saveUpdatedPayIns(updatedPayIns);
  }

  private updatePayInsWithSendData(payInGroup: SendGroup, outTxId: string, type: SendType): CryptoInput[] {
    return payInGroup.payIns.map((p) => this.updatePayInWithSendData(p, type, outTxId)).filter((p) => p != null);
  }

  private async saveUpdatedPayIns(payIns: CryptoInput[]): Promise<void> {
    for (const payIn of payIns) {
      await this.payInRepo.save(payIn);
    }
  }
}
