import type {
  AccountStatus,
  RoleCode,
  RoleScope,
} from "../../core/auth/auth.types";
import {
  toCurrentActorResponseDto,
  toLoginResponseDto,
  toLogoutResponseDto,
} from "./user-account.mapper";

export interface CurrentActorResult {
  account: {
    id: string;
    username: string;
    status: AccountStatus;
    employee: {
      id: string;
      employeeCode: string;
      displayName: string;
    } | null;
  };
  grants: readonly {
    id: string;
    roleCode: RoleCode;
    scope: RoleScope;
    branchId: string | null;
    departmentId: string | null;
  }[];
  capabilities: readonly string[];
}

export interface UserAccountService {
  login(command: {
    username: string;
    password: string;
    requestId: string;
  }): Promise<{ token: string; actor: CurrentActorResult }>;
  logout(command: {
    token: string | undefined;
    requestId: string;
  }): Promise<void>;
  getCurrentActor(command: {
    token: string | undefined;
    requestId: string;
  }): Promise<CurrentActorResult>;
}

export const createUserAccountController = (service: UserAccountService) => ({
  async login(input: {
    body: { username: string; password: string };
    requestId: string;
  }) {
    const result = await service.login({
      username: input.body.username,
      password: input.body.password,
      requestId: input.requestId,
    });

    return {
      body: toLoginResponseDto(result.actor, input.requestId),
      token: result.token,
    };
  },

  async logout(input: { token: string | undefined; requestId: string }) {
    await service.logout(input);
    return toLogoutResponseDto(input.requestId);
  },

  async me(input: { token: string | undefined; requestId: string }) {
    const actor = await service.getCurrentActor(input);
    return toCurrentActorResponseDto(actor, input.requestId);
  },
});

export type UserAccountController = ReturnType<
  typeof createUserAccountController
>;
