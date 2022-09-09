import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { AssetCategory } from 'src/shared/models/asset/asset.entity';
import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { LiquidityOrder, LiquidityOrderContext, LiquidityOrderType } from '../liquidity-order.entity';

export function createDefaultLiquidityOrder(): LiquidityOrder {
  return createCustomLiquidityOrder({});
}

export function createCustomLiquidityOrder(customValues: Partial<LiquidityOrder>): LiquidityOrder {
  const {
    type,
    context,
    correlationId,
    chain,
    referenceAsset,
    referenceAmount,
    targetAsset,
    targetAmount,
    isReady,
    isComplete,
    swapAsset,
    swapAmount,
    purchaseStrategy,
    purchaseTxId,
    purchasedAmount,
  } = customValues;

  const keys = Object.keys(customValues);
  const entity = new LiquidityOrder();

  entity.type = keys.includes('type') ? type : LiquidityOrderType.PURCHASE;
  entity.context = keys.includes('context') ? context : LiquidityOrderContext.BUY_CRYPTO;
  entity.correlationId = keys.includes('correlationId') ? correlationId : 'CID_01';
  entity.chain = keys.includes('chain') ? chain : Blockchain.DEFICHAIN;
  entity.referenceAsset = keys.includes('referenceAsset') ? referenceAsset : 'BTC';
  entity.referenceAmount = keys.includes('referenceAmount') ? referenceAmount : 1;
  entity.targetAsset = keys.includes('targetAsset') ? targetAsset : createDefaultAsset();
  entity.targetAmount = keys.includes('targetAmount') ? targetAmount : 2;
  entity.isReady = keys.includes('isReady') ? isReady : false;
  entity.isComplete = keys.includes('isComplete') ? isComplete : false;
  entity.swapAsset = keys.includes('swapAsset') ? swapAsset : 'DFI';
  entity.swapAmount = keys.includes('swapAmount') ? swapAmount : 1;
  entity.purchaseStrategy = keys.includes('purchaseStrategy') ? purchaseStrategy : AssetCategory.CRYPTO;
  entity.purchaseTxId = keys.includes('purchaseTxId') ? purchaseTxId : 'PID_01';
  entity.purchasedAmount = keys.includes('purchasedAmount') ? purchasedAmount : 2;

  return entity;
}