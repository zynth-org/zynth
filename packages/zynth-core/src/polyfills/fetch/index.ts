import { fetch, Headers, Request, Response } from "./fetch";
import { getGlobalObject } from "./utils";

const globalObject = getGlobalObject();
if (globalObject && typeof globalObject.fetch !== "function") {
  // console.log("[ZynthCore] Polyfilling fetch");
  globalObject.fetch = fetch;
  globalObject.Headers = Headers;
  globalObject.Request = Request;
  globalObject.Response = Response;
}

export { fetch, Headers, Request, Response };
