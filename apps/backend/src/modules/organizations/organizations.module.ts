import { Module } from "@nestjs/common";
import { PERMISSION_RESOLVER } from "../../core/rbac/permission-resolver.port";
import { IdentityModule } from "../identity";
import { BranchesController } from "./api/branches.controller";
import { InvitationsController, MembersController } from "./api/members.controller";
import { OrganizationsController } from "./api/organizations.controller";
import { BranchesService } from "./application/branches.service";
import { InvitationsService } from "./application/invitations.service";
import { MembershipsService } from "./application/memberships.service";
import { OnboardingService } from "./application/onboarding.service";
import { MembershipPermissionResolver } from "./infra/membership-permission.resolver";

@Module({
  imports: [IdentityModule],
  controllers: [
    OrganizationsController,
    MembersController,
    InvitationsController,
    BranchesController,
  ],
  providers: [
    BranchesService,
    InvitationsService,
    MembershipsService,
    OnboardingService,
    MembershipPermissionResolver,
    // Fecha a inversão de dependência: core/rbac declarou a interface, este
    // módulo a satisfaz. O guard global do AppModule injeta este token.
    { provide: PERMISSION_RESOLVER, useExisting: MembershipPermissionResolver },
  ],
  exports: [BranchesService, MembershipsService, PERMISSION_RESOLVER],
})
export class OrganizationsModule {}
