import { apiGet, apiPost, apiPut } from "@/lib/api/client";
import type {
  CreateOperatorResponse,
  OperatorRole,
  OperatorStatus,
  OperatorUser,
} from "@/types";

export const listOperators = () => apiGet<OperatorUser[]>("/operators");

export const createOperator = (payload: {
  name: string;
  email: string;
  role: OperatorRole;
  password?: string;
}) => apiPost<CreateOperatorResponse>("/operators", payload);

export const updateOperator = (
  id: string,
  payload: { name?: string; role?: OperatorRole; status?: OperatorStatus }
) => apiPut<OperatorUser>(`/operators/${id}`, payload);
