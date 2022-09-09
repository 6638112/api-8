import { KrakenService } from './services/kraken.service';
import { BinanceService } from './services/binance.service';
import { BitstampService } from './services/bitstamp.service';
import { BitpandaService } from './services/bitpanda.service';
import { ExchangeController } from './exchange.controller';
import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { CurrencyService } from './services/currency.service';

@Module({
  imports: [SharedModule],
  controllers: [ExchangeController],
  providers: [KrakenService, BinanceService, BitstampService, BitpandaService, CurrencyService],
  exports: [KrakenService, BinanceService, BitstampService, BitpandaService, CurrencyService],
})
export class ExchangeModule {}