import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn, OneToMany, CreateDateColumn } from 'typeorm';
import * as typeorm from 'typeorm';
import { User } from 'src/user/user.entity';

@Entity()
export class Wallet {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true, length: 34 })
  address: string;

  @Column({ type: 'varchar', unique: true, length: 88 })
  signature: string;

  @Column({ type: 'varchar', length: 32, default: '' })
  mail: string;

  @Column({ type: 'varchar', length: 40, default: '' })
  description: string;

  @CreateDateColumn({ name: 'created'}) 
  created: Date;

}