import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FirebaseAuthService } from '../../firebase/firebase-auth.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly firebaseAuth: FirebaseAuthService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.firebaseAuth.isFirebaseAuth()) {
      const req = context.switchToHttp().getRequest<{
        cookies?: Record<string, string>;
        user?: unknown;
      }>();
      const token = req.cookies?.['nodedr_session'];
      if (!token) throw new UnauthorizedException('No session');
      const decoded = await this.firebaseAuth.verifyBearerOrCookie(token);
      if (!decoded.email) throw new UnauthorizedException('Session has no email');
      const user = await this.prisma.user.findFirst({
        where: { email: decoded.email, isActive: true },
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      });
      if (!user) throw new UnauthorizedException('Session no longer valid');
      req.user = {
        id: user.id,
        restaurantId: user.restaurantId,
        name: user.name,
        roleId: user.roleId,
        roleName: user.role.name,
        permissions: user.role.permissions.map((rp) => rp.permission.key),
      };
      return true;
    }
    return (await super.canActivate(context)) as boolean;
  }
}
