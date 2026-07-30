import { Controller, Get, UseGuards } from "@nestjs/common";
import { TenantGuard } from "../../../core/tenant/tenant.guard";
import { BranchesService } from "../application/branches.service";
import type { BranchSummary } from "../application/branches.service";

@Controller("branches")
@UseGuards(TenantGuard)
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  list(): Promise<BranchSummary[]> {
    return this.branches.list();
  }
}
