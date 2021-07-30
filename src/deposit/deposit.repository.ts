import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { UpdateDepositDto } from './dto/update-deposit.dto';
import { Deposit } from './deposit.entity';
import { isNumber, isString } from 'class-validator';

@EntityRepository(Deposit)
export class DepositRepository extends Repository<Deposit> {
  async createDeposit(createDepositDto: CreateDepositDto): Promise<any> {
    if (createDepositDto.id) delete createDepositDto['id'];
    if (createDepositDto.created) delete createDepositDto['created'];

    const deposit = this.create(createDepositDto);

    try {
      await this.save(deposit);
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException();
    }

    return deposit;
  }

  async getAllDeposit(): Promise<any> {
    return await this.find();
  }

  async updateDeposit(depositAddress: UpdateDepositDto): Promise<any> {
    const currentDeposit = await this.findOne({ id: depositAddress.id });

    if (!currentDeposit)
      throw new NotFoundException('No matching deposit address for id found');

    depositAddress.created = currentDeposit.created;

    return Object.assign(currentDeposit, await this.save(depositAddress));
  }

  async getNextDeposit(): Promise<any> {
    const nextAddress = await this.findOne({ used: false });

    nextAddress.used = true;
    await this.save(nextAddress);
    return nextAddress;
  }

  async getDeposit(key: any): Promise<any> {
    if (!isNaN(key.key)) {
      let asset = await this.findOne({ id: key.key });
      if (asset) return asset;
    } else if (isString(key.key)) {
      let asset = await this.findOne({ address: key.key });
      if (asset) return asset;
    } else if (!isNaN(key)) {
      let asset = await this.findOne({ id: key });
      if (asset) return asset;
    } else if (isString(key)) {
      let asset = await this.findOne({ address: key });
      if (asset) return asset;
    }

    throw new NotFoundException('No matching deposit address for id found');
  }
}