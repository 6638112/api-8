import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { BscCoinStrategy } from './impl/bsc-coin.strategy';
import { DeFiChainCryptoStrategy } from './impl/defichain-crypto.strategy';
import { EthereumCoinStrategy } from './impl/ethereum-coin.strategy';
import { PurchaseLiquidityStrategy } from './impl/base/purchase-liquidity.strategy';
import { DeFiChainPoolPairStrategy } from './impl/defichain-poolpair.strategy';
import { DeFiChainStockStrategy } from './impl/defichain-stock.strategy';
import { BscTokenStrategy } from './impl/bsc-token.strategy';
import { BitcoinStrategy } from './impl/bitcoin.strategy';
import { EthereumTokenStrategy } from './impl/ethereum-token.strategy';
import { DeFiChainDfiStrategy } from './impl/defichain-dfi.strategy';
import { ArbitrumCoinStrategy } from './impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy } from './impl/arbitrum-token.strategy';
import { OptimismCoinStrategy } from './impl/optimism-coin.strategy';
import { OptimismTokenStrategy } from './impl/optimism-token.strategy';

enum Alias {
  ARBITRUM_COIN = 'ArbitrumCoin',
  ARBITRUM_TOKEN = 'ArbitrumToken',
  BITCOIN = 'Bitcoin',
  BSC_COIN = 'BscCoin',
  BSC_TOKEN = 'BscToken',
  DEFICHAIN_POOL_PAIR = 'DeFiChainPoolPair',
  DEFICHAIN_STOCK = 'DeFiChainStock',
  DEFICHAIN_CRYPTO = 'DeFiChainCrypto',
  DEFICHAIN_DFI = 'DeFiChainDfi',
  ETHEREUM_COIN = 'EthereumCoin',
  ETHEREUM_TOKEN = 'EthereumToken',
  OPTIMISM_COIN = 'OptimismCoin',
  OPTIMISM_TOKEN = 'OptimismToken',
}

export { Alias as PurchaseLiquidityStrategyAlias };

@Injectable()
export class PurchaseLiquidityStrategies {
  protected readonly strategies = new Map<Alias, PurchaseLiquidityStrategy>();

  constructor(
    arbitrumCoin: ArbitrumCoinStrategy,
    arbitrumToken: ArbitrumTokenStrategy,
    bitcoin: BitcoinStrategy,
    bscCoin: BscCoinStrategy,
    bscToken: BscTokenStrategy,
    deFiChainDfi: DeFiChainDfiStrategy,
    deFiChainCrypto: DeFiChainCryptoStrategy,
    @Inject(forwardRef(() => DeFiChainPoolPairStrategy))
    deFiChainPoolPair: DeFiChainPoolPairStrategy,
    deFiChainStock: DeFiChainStockStrategy,
    ethereumCoin: EthereumCoinStrategy,
    ethereumToken: EthereumTokenStrategy,
    optimismCoin: OptimismCoinStrategy,
    optimismToken: OptimismTokenStrategy,
  ) {
    this.strategies.set(Alias.ARBITRUM_COIN, arbitrumCoin);
    this.strategies.set(Alias.ARBITRUM_TOKEN, arbitrumToken);
    this.strategies.set(Alias.BITCOIN, bitcoin);
    this.strategies.set(Alias.BSC_COIN, bscCoin);
    this.strategies.set(Alias.BSC_TOKEN, bscToken);
    this.strategies.set(Alias.DEFICHAIN_DFI, deFiChainDfi);
    this.strategies.set(Alias.DEFICHAIN_CRYPTO, deFiChainCrypto);
    this.strategies.set(Alias.DEFICHAIN_POOL_PAIR, deFiChainPoolPair);
    this.strategies.set(Alias.DEFICHAIN_STOCK, deFiChainStock);
    this.strategies.set(Alias.ETHEREUM_COIN, ethereumCoin);
    this.strategies.set(Alias.ETHEREUM_TOKEN, ethereumToken);
    this.strategies.set(Alias.OPTIMISM_COIN, optimismCoin);
    this.strategies.set(Alias.OPTIMISM_TOKEN, optimismToken);
  }

  getPurchaseLiquidityStrategy(criteria: Asset | Alias): PurchaseLiquidityStrategy {
    return criteria instanceof Asset ? this.getByAsset(criteria) : this.getByAlias(criteria);
  }

  //*** HELPER METHODS ***//

  private getByAlias(alias: Alias): PurchaseLiquidityStrategy {
    const strategy = this.strategies.get(alias);

    if (!strategy) throw new Error(`No PurchaseLiquidityStrategy found. Alias: ${alias}`);

    return strategy;
  }

  private getByAsset(asset: Asset): PurchaseLiquidityStrategy {
    const alias = this.getAlias(asset);

    return this.getByAlias(alias);
  }

  private getAlias(asset: Asset): Alias {
    const { dexName, blockchain, category: assetCategory, type: assetType } = asset;

    if (blockchain === Blockchain.BITCOIN) return Alias.BITCOIN;

    if (blockchain === Blockchain.BINANCE_SMART_CHAIN) {
      return assetType === AssetType.COIN ? Alias.BSC_COIN : Alias.BSC_TOKEN;
    }

    if (blockchain === Blockchain.DEFICHAIN) {
      if (assetCategory === AssetCategory.CRYPTO && dexName === 'DFI') return Alias.DEFICHAIN_DFI;
      if (assetCategory === AssetCategory.CRYPTO) return Alias.DEFICHAIN_CRYPTO;
      if (assetCategory === AssetCategory.POOL_PAIR) return Alias.DEFICHAIN_POOL_PAIR;
      if (assetCategory === AssetCategory.STOCK) return Alias.DEFICHAIN_STOCK;
    }

    if (blockchain === Blockchain.ETHEREUM) {
      return assetType === AssetType.COIN ? Alias.ETHEREUM_COIN : Alias.ETHEREUM_TOKEN;
    }

    if (blockchain === Blockchain.ARBITRUM) {
      return assetType === AssetType.COIN ? Alias.ARBITRUM_COIN : Alias.ARBITRUM_TOKEN;
    }

    if (blockchain === Blockchain.OPTIMISM) {
      return assetType === AssetType.COIN ? Alias.OPTIMISM_COIN : Alias.OPTIMISM_TOKEN;
    }
  }
}
