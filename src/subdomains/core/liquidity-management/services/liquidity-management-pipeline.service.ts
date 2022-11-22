import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LiquidityManagementOrder } from '../entities/liquidity-management-order.entity';
import { LiquidityManagementOrderStatus, LiquidityManagementPipelineStatus } from '../enums';
import { OrderNotProcessableException } from '../exceptions/order-not-processable.exception';
import { LiquidityManagementOrderRepository } from '../repositories/liquidity-management-order.repository';
import { LiquidityManagementPipelineRepository } from '../repositories/liquidity-management-pipeline.repository';
import { LiquidityManagementPipeline } from '../entities/liquidity-management-pipeline.entity';
import { Lock } from 'src/shared/utils/lock';
import { LiquidityActionIntegrationFactory } from '../factories/liquidity-action-integration.factory';
import { LiquidityManagementRuleRepository } from '../repositories/liquidity-management-rule.repository';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailRequest } from 'src/subdomains/supporting/notification/interfaces';

@Injectable()
export class LiquidityManagementPipelineService {
  private readonly processPipelinesLock = new Lock(1800);
  private readonly processOrdersLock = new Lock(1800);

  constructor(
    private readonly ruleRepo: LiquidityManagementRuleRepository,
    private readonly orderRepo: LiquidityManagementOrderRepository,
    private readonly pipelineRepo: LiquidityManagementPipelineRepository,
    private readonly actionIntegrationFactory: LiquidityActionIntegrationFactory,
    private readonly notificationService: NotificationService,
  ) {}

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_MINUTE)
  async processPipelines() {
    if (!this.processPipelinesLock.acquire()) return;

    try {
      await this.startNewPipelines();
      await this.checkRunningPipelines();
    } catch (e) {
      console.error('Error while processing liquidity management pipelines', e);
    } finally {
      this.processPipelinesLock.release();
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processOrders() {
    if (!this.processOrdersLock.acquire()) return;

    try {
      await this.startNewOrders();
      await this.checkRunningOrders();
    } catch (e) {
      console.error('Error while processing liquidity management orders', e);
    } finally {
      this.processOrdersLock.release();
    }
  }

  //*** PUBLIC API ***//

  async getProcessingPipelines(): Promise<LiquidityManagementPipeline[]> {
    return this.pipelineRepo.find({
      where: [
        { status: LiquidityManagementPipelineStatus.CREATED },
        { status: LiquidityManagementPipelineStatus.IN_PROGRESS },
      ],
    });
  }

  async getStoppedPipelines(): Promise<LiquidityManagementPipeline[]> {
    return this.pipelineRepo.find({
      status: LiquidityManagementPipelineStatus.STOPPED,
    });
  }

  async getProcessingOrders(): Promise<LiquidityManagementOrder[]> {
    return this.orderRepo.find({
      where: [
        { status: LiquidityManagementOrderStatus.CREATED },
        { status: LiquidityManagementOrderStatus.IN_PROGRESS },
      ],
    });
  }

  //*** HELPER METHODS ***//

  async startNewPipelines(): Promise<void> {
    const newPipelines = await this.pipelineRepo.find({
      where: { status: LiquidityManagementPipelineStatus.CREATED },
    });

    this.logNewPipelines(newPipelines);

    for (const pipeline of newPipelines) {
      try {
        pipeline.start();
        await this.pipelineRepo.save(pipeline);
      } catch (e) {
        console.error(`Error in starting new liquidity pipeline. Pipeline ID: ${pipeline.id}`, e);
        continue;
      }
    }
  }

  private async checkRunningPipelines(): Promise<void> {
    const runningPipelines = await this.pipelineRepo.find({
      where: { status: LiquidityManagementPipelineStatus.IN_PROGRESS },
      relations: ['currentAction', 'currentAction.onSuccess', 'currentAction.onFail'],
    });

    for (const pipeline of runningPipelines) {
      try {
        const order = await this.orderRepo.findOne({
          pipeline,
          action: pipeline.currentAction,
        });

        if (!order) {
          await this.placeLiquidityOrder(pipeline);
          continue;
        }

        if (
          order.status === LiquidityManagementOrderStatus.COMPLETE ||
          order.status === LiquidityManagementOrderStatus.FAILED
        ) {
          pipeline.continue(order.status);
          await this.pipelineRepo.save(pipeline);

          if (pipeline.status === LiquidityManagementPipelineStatus.COMPLETE) {
            await this.handlePipelineCompletion(pipeline);
            continue;
          }

          if (pipeline.status === LiquidityManagementPipelineStatus.FAILED) {
            await this.handlePipelineFail(pipeline);
            continue;
          }

          console.log(
            `Continue with next liquidity management pipeline action. Action ID: ${pipeline.currentAction.id}`,
          );
        }
      } catch (e) {
        console.error(`Error in checking running liquidity pipeline. Pipeline ID: ${pipeline.id}`, e);
        continue;
      }
    }
  }

  private async placeLiquidityOrder(pipeline: LiquidityManagementPipeline): Promise<void> {
    const { targetAmount, currentAction } = pipeline;
    const order = LiquidityManagementOrder.create(targetAmount, pipeline, currentAction);

    await this.orderRepo.save(order);
  }

  private async startNewOrders(): Promise<void> {
    const newOrders = await this.orderRepo.find({ status: LiquidityManagementOrderStatus.CREATED });

    for (const order of newOrders) {
      try {
        await this.executeOrder(order);
      } catch (e) {
        if (e instanceof OrderNotProcessableException) {
          order.fail();
          await this.orderRepo.save(order);
          continue;
        }

        console.error(`Error in starting new liquidity order. Order ID: ${order.id}`, e);
      }
    }
  }

  private async executeOrder(order: LiquidityManagementOrder): Promise<void> {
    const actionIntegration = this.actionIntegrationFactory.getIntegration(order.action);

    await actionIntegration.executeOrder(order);
    order.inProgress();

    await this.orderRepo.save(order);
  }

  private async checkRunningOrders(): Promise<void> {
    const runningOrders = await this.orderRepo.find({ status: LiquidityManagementOrderStatus.IN_PROGRESS });

    for (const order of runningOrders) {
      try {
        await this.checkOrder(order);
      } catch (e) {
        if (e instanceof OrderNotProcessableException) {
          order.fail();
          await this.orderRepo.save(order);
          continue;
        }

        console.error(`Error in checking running liquidity order. Order ID: ${order.id}`, e);
      }
    }
  }

  private async checkOrder(order: LiquidityManagementOrder): Promise<void> {
    const actionIntegration = this.actionIntegrationFactory.getIntegration(order.action);
    const isComplete = await actionIntegration.checkCompletion(order.id.toString());

    if (isComplete) {
      order.complete();
      await this.orderRepo.save(order);

      console.log(`Liquidity management order complete. Order ID: ${order.id}`);
    }
  }

  private async handlePipelineCompletion(pipeline: LiquidityManagementPipeline): Promise<void> {
    const rule = pipeline.rule.reactivate();

    await this.ruleRepo.save(rule);

    const [successMessage, mailRequest] = this.generateSuccessMessage(pipeline);

    await this.notificationService.sendMail(mailRequest);

    console.log(successMessage);
  }

  private async handlePipelineFail(pipeline: LiquidityManagementPipeline): Promise<void> {
    const rule = pipeline.rule.pause();

    await this.ruleRepo.save(rule);

    const [errorMessage, mailRequest] = this.generateFailMessage(pipeline);

    console.log(errorMessage);

    await this.notificationService.sendMail(mailRequest);
  }

  private generateSuccessMessage(pipeline: LiquidityManagementPipeline): [string, MailRequest] {
    const { type, targetAmount, rule } = pipeline;
    const successMessage = `Successfully completed a ${type} pipeline for ${targetAmount} ${rule.target.name}. Pipeline ID: ${pipeline.id}. Rule ${pipeline.rule.id} optimized.`;

    const mailRequest: MailRequest = {
      type: MailType.ERROR_MONITORING,
      input: {
        subject: 'Liquidity management pipeline SUCCESS',
        errors: [successMessage],
      },
      metadata: {
        context: MailContext.LIQUIDITY_MANAGEMENT,
        correlationId: `LiquidityManagementPipeline_${pipeline.id}`,
      },
      options: {
        suppressRecurring: true,
      },
    };

    return [successMessage, mailRequest];
  }

  private generateFailMessage(pipeline: LiquidityManagementPipeline): [string, MailRequest] {
    const errorMessage = `Liquidity management pipeline failed. Rule ${pipeline.rule.id} is paused. Pipeline ID: ${pipeline.id}`;

    const mailRequest: MailRequest = {
      type: MailType.ERROR_MONITORING,
      input: {
        subject: 'Liquidity management pipeline failed',
        errors: [errorMessage],
      },
      metadata: {
        context: MailContext.LIQUIDITY_MANAGEMENT,
        correlationId: `LiquidityManagementPipeline_${pipeline.id}`,
      },
      options: {
        suppressRecurring: true,
      },
    };

    return [errorMessage, mailRequest];
  }

  private logNewPipelines(newPipelines: LiquidityManagementPipeline[]): void {
    newPipelines.length > 0 &&
      console.log(
        `Starting ${newPipelines.length} new liquidity management pipeline(s). Rules: `,
        newPipelines.map((p) => p.rule.id),
      );
  }
}