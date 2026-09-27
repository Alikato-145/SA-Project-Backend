import Elysia from "elysia";
import { REQUEST_ID_HEADER, resolveRequestId } from "./action-context";

export const requestIdPlugin = new Elysia({ name: "request-id" }).derive(
  { as: "global" },
  ({ request, set }) => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    set.headers[REQUEST_ID_HEADER] = requestId;
    return { requestId };
  },
);

