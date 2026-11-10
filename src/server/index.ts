// Explicit public API: adding an implementation export does not expand this surface.
export type { HeliumConfig, HeliumRpcSecurityConfig, HeliumSecurityConfig, RpcClientConfig } from "./config.js";
export { clearConfigCache, getRpcClientConfig, getRpcConfig, getRpcSecurityConfig, getTrustProxyDepth, loadConfig } from "./config.js";
export type { HeliumContext } from "./context.js";
export type { HeliumHTTPDef, HTTPHandler, HTTPMethod, HTTPRequest } from "./defineHTTPRequest.js";
export { defineHTTPRequest } from "./defineHTTPRequest.js";
export type { DefineMethodOptions, HeliumMethodDef, MethodInputParser } from "./defineMethod.js";
export { defineMethod, MethodInputError } from "./defineMethod.js";
export type { HeliumSEOMetadataDef, SEOMetadataHandler, SEOMetadataRequest } from "./defineSEOMetadata.js";
export { defineSEOMetadata } from "./defineSEOMetadata.js";
export type {
    GetServerSideProps,
    ServerSidePropsHandler,
    ServerSidePropsRequest,
    ServerSidePropsResult,
    ServerSideRedirect,
    ServerSideRedirectResult,
} from "./defineServerSideProps.js";
export type { HeliumWorkerDef, WorkerCleanup, WorkerHandler, WorkerInstance, WorkerLifecycle, WorkerOptions } from "./defineWorker.js";
export { defineWorker, getWorkerById, getWorkerStatus, startWorker, stopAllWorkers, stopWorker } from "./defineWorker.js";
export type { SocialMeta } from "./meta.js";
export { buildSocialMetaTags, escapeHtml, extractSocialMetaFromHtml, injectSocialMetaIntoHtml, loadDefaultSocialMetaFromHtmlFile } from "./meta.js";
export type { HeliumMiddleware, MiddlewareContext, MiddlewareFunction, MiddlewareNext } from "./middleware.js";
export { defineMiddleware, middleware } from "./middleware.js";

// Production server API
export type { HTTPRouter } from "./httpRouter.js";
export { startProdServer } from "./prodServer.js";
export type { RpcRegistry } from "./rpcRegistry.js";
export { PublicError } from "./rpcRegistry.js";

// Compatibility aliases for existing generated code. New generated code should
// import these implementation helpers from heliumts/internal.
export { injectEnvToProcess, loadEnvFiles } from "../utils/envLoader.js";
export { log } from "../utils/logger.js";
