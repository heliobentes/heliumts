import type { HeliumContext } from "./context.js";

export interface ServerSidePropsRequest {
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
    query: Record<string, string>;
    params: Record<string, string | string[]>;
}

export interface ServerSideRedirect {
    destination: string;
    permanent?: boolean;
    statusCode?: 301 | 302 | 303 | 307 | 308;
    replace?: boolean;
}

export interface ServerSideRedirectResult {
    redirect: ServerSideRedirect;
}

export type ServerSidePropsResult = Record<string, unknown> | ServerSideRedirectResult | null | undefined;

export type ServerSidePropsHandler = (req: ServerSidePropsRequest, ctx: HeliumContext) => Promise<ServerSidePropsResult> | ServerSidePropsResult;

/**
 * Type for convention-based page server props functions:
 *
 * ```ts
 * import type { GetServerSideProps } from "heliumts/server";
 *
 * export const getServerSideProps: GetServerSideProps = async (req, ctx) => {
 *   return { user: await getUser(req) };
 * };
 * ```
 */
export type GetServerSideProps = ServerSidePropsHandler;
