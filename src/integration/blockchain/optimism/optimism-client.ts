import { asL2Provider, estimateTotalGasCost, CrossChainMessenger, MessageStatus, L2Provider } from '@eth-optimism/sdk';
import { BigNumber, Contract, ethers } from 'ethers';
import { GetConfig } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { EvmClient } from '../shared/evm/evm-client';
import { L2BridgeEvmClient } from '../shared/evm/interfaces';
import ERC20_ABI from '../shared/evm/abi/erc20.abi.json';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { ChainId } from '@uniswap/smart-order-router';

interface OptimismTransactionReceipt extends ethers.providers.TransactionReceipt {
  l1GasPrice: BigNumber;
  l1GasUsed: BigNumber;
  l1FeeScalar: number;
}

export class OptimismClient extends EvmClient implements L2BridgeEvmClient {
  private readonly logger = new DfxLogger(OptimismClient);

  #l1Provider: ethers.providers.JsonRpcProvider;
  #l1Wallet: ethers.Wallet;

  #crossChainMessenger: CrossChainMessenger;

  constructor(
    http: HttpService,
    scanApiUrl: string,
    scanApiKey: string,
    gatewayUrl: string,
    privateKey: string,
    chainId: ChainId,
  ) {
    super(http, scanApiUrl, scanApiKey, chainId, gatewayUrl, privateKey);

    const { ethGatewayUrl, ethApiKey, ethWalletPrivateKey, ethChainId } = GetConfig().blockchain.ethereum;
    const { optimismChainId } = GetConfig().blockchain.optimism;
    const ethereumGateway = `${ethGatewayUrl}/${ethApiKey ?? ''}`;

    this.#l1Provider = new ethers.providers.JsonRpcProvider(ethereumGateway);
    this.#l1Wallet = new ethers.Wallet(ethWalletPrivateKey, this.#l1Provider);

    this.#crossChainMessenger = new CrossChainMessenger({
      l1ChainId: ethChainId,
      l2ChainId: optimismChainId,
      l1SignerOrProvider: this.#l1Wallet,
      l2SignerOrProvider: this.wallet,
      bedrock: true,
    });
  }

  async depositCoinOnDex(amount: number): Promise<string> {
    const response = await this.#crossChainMessenger.depositETH(this.convertToWeiLikeDenomination(amount, 'ether'));

    return response.hash;
  }

  async withdrawCoinOnDex(amount: number): Promise<string> {
    const response = await this.#crossChainMessenger.withdrawETH(this.convertToWeiLikeDenomination(amount, 'ether'));

    return response.hash;
  }

  async approveToken(l1Token: Asset, l2Token: Asset): Promise<string> {
    const allowanceResponse = await this.#crossChainMessenger.approveERC20(l1Token.chainId, l2Token.chainId, Infinity);

    return allowanceResponse.hash;
  }

  async depositTokenOnDex(l1Token: Asset, l2Token: Asset, amount: number): Promise<string> {
    const l1Contract = this.getERC20ContractForDexL1(l1Token.chainId);
    const l2Contract = this.getERC20ContractForDex(l2Token.chainId);

    const l1Decimals = await l1Contract.decimals();
    const l2Decimals = await l2Contract.decimals();

    if (l1Decimals !== l2Decimals) {
      throw new Error(
        `Cannot bridge/deposit Optimism tokens with different decimals. L1 Token: ${l1Token.uniqueName} has ${l1Decimals}, L2 Token: ${l2Token.uniqueName} has ${l2Decimals}`,
      );
    }

    const response = await this.#crossChainMessenger.depositERC20(
      l1Token.chainId,
      l2Token.chainId,
      this.convertToWeiLikeDenomination(amount, l1Decimals),
    );

    return response.hash;
  }

  async withdrawTokenOnDex(l1Token: Asset, l2Token: Asset, amount: number): Promise<string> {
    const l1Contract = this.getERC20ContractForDexL1(l1Token.chainId);
    const l2Contract = this.getERC20ContractForDex(l2Token.chainId);

    const l1Decimals = await l1Contract.decimals();
    const l2Decimals = await l2Contract.decimals();

    if (l1Decimals !== l2Decimals) {
      throw new Error(
        `Cannot bridge/withdraw Optimism tokens with different decimals. L1 Token: ${l1Token.uniqueName} has ${l1Decimals}, L2 Token: ${l2Token.uniqueName} has ${l2Decimals}`,
      );
    }

    const response = await this.#crossChainMessenger.withdrawERC20(
      l1Token.chainId,
      l2Token.chainId,
      this.convertToWeiLikeDenomination(amount, l1Decimals),
    );

    return response.hash;
  }

  async checkL2BridgeCompletion(l1TxId: string): Promise<boolean> {
    try {
      const status = await Util.timeout(this.#crossChainMessenger.getMessageStatus(l1TxId), 20000);

      return status === MessageStatus.RELAYED;
    } catch {
      return false;
    }
  }

  async checkL1BridgeCompletion(l2TxId: string): Promise<boolean> {
    try {
      const status = await Util.timeout(this.#crossChainMessenger.getMessageStatus(l2TxId), 20000);

      switch (status) {
        case MessageStatus.READY_TO_PROVE: {
          this.logger.verbose(
            `Checking L1 Bridge transaction completion, L2 txId: ${l2TxId}, status: READY_TO_PROVE, running #proveMessage(...)`,
          );
          await this.#crossChainMessenger.proveMessage(l2TxId);

          return false;
        }

        case MessageStatus.READY_FOR_RELAY: {
          this.logger.verbose(
            `Checking L1 Bridge transaction completion, L2 txId: ${l2TxId}, status: READY_FOR_RELAY, running #finalizeMessage(...)`,
          );
          await this.#crossChainMessenger.finalizeMessage(l2TxId);

          return false;
        }

        case MessageStatus.RELAYED: {
          return true;
        }

        default:
          return false;
      }
    } catch (e) {
      return false;
    }
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    const totalGasCost = await estimateTotalGasCost(this.l2Provider, {
      from: this.dfxAddress,
      to: this.randomReceiverAddress,
      value: 1,
    });

    return this.convertToEthLikeDenomination(totalGasCost);
  }

  async getCurrentGasCostForTokenTransaction(token: Asset): Promise<number> {
    const totalGasCost = await estimateTotalGasCost(this.l2Provider, {
      from: this.dfxAddress,
      to: token.chainId,
      data: this.dummyTokenPayload,
    });

    return this.convertToEthLikeDenomination(totalGasCost);
  }

  /**
   * @overwrite
   */
  async getTxActualFee(txHash: string): Promise<number> {
    const gasPrice = await this.provider.getGasPrice();

    const receipt = await this.l2Provider.getTransactionReceipt(txHash);

    const { gasUsed, l1GasPrice, l1GasUsed, l1FeeScalar } = receipt as OptimismTransactionReceipt;

    const actualL2Fee = gasUsed.mul(gasPrice);
    const actualL1Fee = l1GasUsed.mul(l1GasPrice).mul(l1FeeScalar);

    return this.convertToEthLikeDenomination(actualL2Fee.add(actualL1Fee));
  }

  //*** HELPER METHODS ***//

  private getERC20ContractForDexL1(chainId: string): Contract {
    return new ethers.Contract(chainId, ERC20_ABI, this.#l1Wallet);
  }

  private get l2Provider(): L2Provider<ethers.providers.JsonRpcProvider> {
    return asL2Provider(this.provider);
  }
}
