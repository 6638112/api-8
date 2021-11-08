import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsInt, IsEnum } from 'class-validator';
import { UserRole } from 'src/shared/auth/user-role.enum';

export class UpdateRoleDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  id: number;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @IsEnum(UserRole)
  role: UserRole;
}