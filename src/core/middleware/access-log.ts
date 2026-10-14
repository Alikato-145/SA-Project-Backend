import Elysia from "elysia";
import { resolveRequestId } from "../audit/action-context";
export const accessLog = () => {
  const started = new WeakMap<Request, number>();
  return new Elysia({name:"access-log"})
    .onRequest(({request})=>{started.set(request,performance.now());})
    .onAfterResponse({as:"global"},({request,route,set,responseValue})=>{
      if(route.includes("/health/"))return;
      console.info(JSON.stringify({event:"http.request",request_id:resolveRequestId(String(set.headers["x-request-id"] ?? request.headers.get("x-request-id") ?? "")),method:request.method,route:route || "unmatched",status:responseValue instanceof Response ? responseValue.status : typeof set.status==="number" ? set.status : 200,duration_ms:Math.round(performance.now()-(started.get(request)??performance.now()))}));
    });
};
