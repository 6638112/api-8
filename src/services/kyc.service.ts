import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Method } from 'axios';
import { createHash } from 'crypto';
import { HttpService } from './http.service';

interface Challenge {
  key: string;
  challenge: string;
}

interface CheckResponse {
  customerReference: string;
  customerId: number;
  customerVersionId: number;
  checkId: number;
  checkTime: number;
  riskState: string;
}

interface CreateResponse {
  customerReference: string;
  customerId: number;
  customerVersionId: number;
}

@Injectable()
export class KycService {
  private baseUrl = 'https://kyc.eurospider.com/kyc-v8-api/rest/2.0.0';

  constructor(private http: HttpService) {}

  async createCustomer(id: number, name: string): Promise<number> {
    const data = {
      reference: id.toString(),
      type: 'PERSON',
      names: [{ lastName: name }],
    };

    try {
      const result = await this.callApi<CreateResponse>('customers/simple', 'POST', data);
      return result.customerId;
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to register KYC customer');
    }
  }

  async checkCustomer(id: number): Promise<boolean> {
    try {
      const results = await this.callApi<CheckResponse[]>('customers/check', 'POST', [id.toString()]);
      return results[0].riskState === 'NO_RISKS_FOUND';
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to do name check');
    }
  }

  // --- HELPER METHODS --- //
  private async callApi<T>(url: string, method: Method, data?: any): Promise<T> {
    const sessionKey = await this.getSessionKey();
    return await this.http.request<T>({
      url: `${this.baseUrl}/${url}`,
      method: method,
      data: data,
      headers: {
        'Content-Type': 'application/json',
        'Session-Key': sessionKey,
      },
    });
  }

  private async getSessionKey(): Promise<string> {
    // get the challenge
    const { key, challenge } = await this.http.get<Challenge>(`${this.baseUrl}/challenge`);

    // determine response
    const response = key + process.env.KYC_MANDATOR + process.env.KYC_USER + process.env.KYC_PASSWORD + challenge;
    const hash = createHash('sha1');
    hash.update(response);

    const data = {
      key: key,
      mandator: process.env.KYC_MANDATOR,
      user: process.env.KYC_USER,
      response: hash.digest('hex'),
    };

    // enable the session key
    await this.http.post(`${this.baseUrl}/authenticate`, data);

    return key;
  }
}