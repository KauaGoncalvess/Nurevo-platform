import { Module } from "@nestjs/common";
import { BranchesController } from "./api/branches.controller";
import { BranchesService } from "./application/branches.service";

@Module({
  controllers: [BranchesController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class OrganizationsModule {}
