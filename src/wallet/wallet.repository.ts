import { InternalServerErrorException, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateWalletDto } from "./dto/create-wallet.dto";
import { UpdateWalletDto } from "./dto/update-wallet.dto";
import { Wallet } from "./wallet.entity";
import { isNumber, isString } from "class-validator";

@EntityRepository(Wallet)
export class WalletRepository extends Repository<Wallet> {
    async createWallet(createWalletDto: CreateWalletDto): Promise<any> {
   
        if(createWalletDto.id) delete createWalletDto["id"];
        if (createWalletDto.created) delete createWalletDto['created'];

        const wallet = this.create(createWalletDto);

        try {
            await this.save(wallet);
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }

        return wallet;
    }

    async getAllWallet(): Promise<any> {
        return await this.find();
    }

    async getWallet(key:any): Promise<any> {
   
        if(!isNaN(key.key)){
            let asset = await this.findOne({ "id" : key.key });
            
            if(asset) return asset;
            
        }else if(isString(key.key)){

            let asset = await this.findOne({ "address" : key.key });
            
            if(asset) return asset;
            
            throw new NotFoundException( "No matching wallet found");
        }

        throw new BadRequestException("key must be number or a string or JSON-Object")
    }

    async updateWallet(editWalletDto: UpdateWalletDto): Promise<any>{
        const currentWallet = await this.findOne({ "id" : editWalletDto.id });
        
        if(!currentWallet) throw new NotFoundException( "No matching wallet for id found");

        if (editWalletDto.created) delete editWalletDto['created'];

        return Object.assign(currentWallet, await this.save(editWalletDto));
    }




}