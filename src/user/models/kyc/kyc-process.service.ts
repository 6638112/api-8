import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { SpiderDataRepository } from 'src/user/models/spider-data/spider-data.repository';
import { KycInProgress, KycState, KycStatus, UserData } from 'src/user/models/user-data/user-data.entity';
import { KycDocument, KycDocuments, InitiateResponse } from '../../services/spider/dto/spider.dto';
import { AccountType } from 'src/user/models/user-data/account-type.enum';
import { MailService } from 'src/shared/services/mail.service';
import { IdentResultDto } from 'src/user/models/ident/dto/ident-result.dto';
import { DocumentState, SpiderService } from 'src/user/services/spider/spider.service';
import { UserDataService } from '../user-data/user-data.service';

@Injectable()
export class KycProcessService {
  constructor(
    private readonly userDataService: UserDataService,
    private readonly spiderDataRepo: SpiderDataRepository,
    private readonly spiderService: SpiderService,
    private readonly mailService: MailService,
  ) {}

  // --- GENERAL METHODS --- //
  async startKycProcess(userData: UserData): Promise<UserData> {
    return await this.goToStatus(userData, KycStatus.CHATBOT);
  }

  async checkKycProcess(userData: UserData): Promise<UserData> {
    // check if chatbot already finished
    if (userData.kycStatus === KycStatus.CHATBOT) {
      const chatbotProgress = await this.getKycProgress(userData.id, userData.kycStatus);
      if (chatbotProgress === DocumentState.COMPLETED) {
        return await this.chatbotCompleted(userData);
      }
    }

    // retrigger, if failed
    if (userData.kycState === KycState.FAILED) {
      return await this.goToStatus(userData, userData.kycStatus);
    }

    return userData;
  }

  async getKycProgress(userDataId: number, kycStatus: KycStatus): Promise<DocumentState> {
    const documentType = KycDocuments[kycStatus].document;
    return await this.spiderService.getDocumentState(userDataId, documentType);
  }

  async goToStatus(userData: UserData, status: KycStatus): Promise<UserData> {
    if (KycInProgress(status)) {
      const identType = KycDocuments[status].ident;
      const initiateData = await this.spiderService.initiateIdentification(userData.id, identType);
      userData.spiderData = await this.updateSpiderData(userData, initiateData);
    }

    return this.updateKycStatus(userData, status);
  }

  private updateKycStatus(userData: UserData, status: KycStatus): UserData {
    console.log(`KYC change: status of user ${userData.id}: ${userData.kycStatus} -> ${status}`);

    userData.kycStatus = status;
    userData.kycState = KycState.NA;
    userData.kycStatusChangeDate = new Date();
    return userData;
  }

  updateKycState(userData: UserData, state: KycState): UserData {
    console.log(
      `KYC change: state of user ${userData.id} (${userData.kycStatus}): ${
        userData.kycState
      } -> ${state} (last change on ${userData.kycStatusChangeDate?.toLocaleString()})`,
    );

    userData.kycState = state;
    return userData;
  }

  async stepFailed(userData: UserData): Promise<UserData> {
    // online ID failed => trigger video ID
    if (userData.kycStatus === KycStatus.ONLINE_ID) {
      userData = await this.goToStatus(userData, KycStatus.VIDEO_ID);

      await this.mailService.sendOnlineFailedMail(
        userData.mail,
        userData?.language?.symbol?.toLocaleLowerCase(),
        userData.spiderData?.url,
      );
      return userData;
    }

    // notify support
    await this.mailService.sendKycFailedMail(userData, userData.kycCustomerId);
    return this.updateKycState(userData, KycState.FAILED);
  }

  // --- CHATBOT --- //
  async chatbotCompleted(userData: UserData): Promise<UserData> {
    userData.riskState = await this.spiderService.checkCustomer(userData.id);

    userData = await this.storeChatbotResult(userData);

    const isVipUser = await this.userDataService.hasRole(userData.id, UserRole.VIP);
    return isVipUser
      ? await this.goToStatus(userData, KycStatus.VIDEO_ID)
      : await this.goToStatus(userData, KycStatus.ONLINE_ID);
  }

  async storeChatbotResult(userData: UserData): Promise<UserData> {
    try {
      const spiderData = userData.spiderData ?? (await this.spiderDataRepo.findOne({ userData: { id: userData.id } }));
      if (spiderData) {
        // get and store the result
        const chatbotResult = {
          person: await this.spiderService.getChatbotResult(userData.id, false),
          organization:
            userData.accountType === AccountType.PERSONAL
              ? undefined
              : await this.spiderService.getChatbotResult(userData.id, true),
        };

        spiderData.chatbotResult = JSON.stringify(chatbotResult);
        userData.spiderData = await this.spiderDataRepo.save(spiderData);

        // update user data
        const result =
          userData.accountType === AccountType.PERSONAL ? chatbotResult.person : chatbotResult.organization;
        userData.contribution = +result.contribution;
        userData.plannedContribution = result.plannedDevelopmentOfAssets;
      }
    } catch (e) {
      console.error(`Failed to store chatbot result for user ${userData.id}:`, e);
    }

    return userData;
  }

  // --- IDENT --- //
  async identCompleted(userData: UserData, result: IdentResultDto): Promise<UserData> {
    userData = await this.storeIdentResult(userData, result);

    await this.mailService.sendIdentificationCompleteMail(userData.mail, userData.language?.symbol?.toLowerCase());
    return await this.goToStatus(userData, KycStatus.CHECK);
  }

  async identInReview(userData: UserData, result: IdentResultDto): Promise<UserData> {
    userData = await this.storeIdentResult(userData, result);

    return this.updateKycState(userData, KycState.REVIEW);
  }

  async identFailed(userData: UserData, result: IdentResultDto): Promise<UserData> {
    userData = await this.storeIdentResult(userData, result);

    return await this.stepFailed(userData);
  }

  async storeIdentResult(userData: UserData, result: IdentResultDto): Promise<UserData> {
    try {
      const spiderData = userData.spiderData ?? (await this.spiderDataRepo.findOne({ userData: { id: userData.id } }));
      if (spiderData) {
        spiderData.identResult = JSON.stringify(result);
        userData.spiderData = await this.spiderDataRepo.save(spiderData);
      }
    } catch (e) {
      console.error(`Failed to store ident result for user ${userData.id}:`, e);
    }

    return userData;
  }

  // --- HELPER METHODS --- //
  private async updateSpiderData(userData: UserData, initiateData: InitiateResponse) {
    const spiderData =
      (await this.spiderDataRepo.findOne({ userData: { id: userData.id } })) ??
      this.spiderDataRepo.create({ userData: userData });

    const locator = initiateData.locators?.[0];
    if (!locator) {
      console.error(`Failed to initiate identification. Initiate result:`, initiateData);
      throw new ServiceUnavailableException('Identification initiation failed');
    }

    switch (locator.document) {
      case KycDocument.CHATBOT:
        spiderData.url = initiateData.sessionUrl + '&nc=true';
        break;

      case KycDocument.ONLINE_IDENTIFICATION:
        const log = await this.spiderService.getOnlineIdLog(userData, locator.version);

        spiderData.url = initiateData.sessionUrl;
        spiderData.secondUrl = log ? this.spiderService.getOnlineIdUrl(log.identificationId) : null;
        spiderData.identTransactionId = log ? log.transactionId : null;
        break;

      case KycDocument.VIDEO_IDENTIFICATION:
        spiderData.url = initiateData.sessionUrl;
        spiderData.secondUrl = null;
        spiderData.identTransactionId = await this.spiderService.getVideoTransactionId(initiateData.sessionUrl);
        break;
    }

    return await this.spiderDataRepo.save(spiderData);
  }
}