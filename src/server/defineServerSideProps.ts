import type { HeliumContext } from "./context.js";

export interface ServerSidePropsRequest {
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
    query: Record<string, string>;
    params: Record<string, string | string[]>;
}

export type ServerSidePropsHandler = (
    req: ServerSidePropsRequest,
    ctx: HeliumContext
) => Promise<Record<string, unknown> | null | undefined> | Record<string, unknown> | null | undefined;

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
