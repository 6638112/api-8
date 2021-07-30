import { Body, Controller, Get, Param, Put, UseGuards, Request, ForbiddenException,Post } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags} from '@nestjs/swagger';
import { GetUser } from 'src/auth/get-user.decorator';
import { RoleGuard } from 'src/guards/role.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from "./dto/update-user.dto";
import { UpdateRoleDto } from "./dto/update-role.dto";
import { User, UserRole } from './user.entity';
import { UserService } from './user.service';
import { UpdateStatusDto } from './dto/update-status.dto';

@ApiTags('user')
@Controller('user')
export class UserController {
    constructor(private readonly userService: UserService){}

    @Get()
    @ApiBearerAuth()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
    async getUser(@GetUser() user: User): Promise<any> {
        return this.userService.getUser(user);
    }

    @Put()
    @ApiBearerAuth()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
    async updateUser(@GetUser() oldUser: User,@Body() newUser: UpdateUserDto): Promise<any> {
        newUser.address = oldUser.address;
        newUser.signature = oldUser.signature;
        return this.userService.updateUser(oldUser,newUser);
    }

    @Get('all')
    @ApiBearerAuth()
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    async getAllUser(): Promise<any> {
        return this.userService.getAllUser();
    }

    @Put('role')
    @ApiBearerAuth()
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    async updateRole(@Body() user: UpdateRoleDto): Promise<any> {
        return this.userService.updateRole(user);
    }

    @Put('status')
    @ApiBearerAuth()
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    async updateStatus(@Body() user: UpdateStatusDto): Promise<any> {
        return this.userService.updateStatus(user);
    }
}