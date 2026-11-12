import pg from "pg";
import { getConnectionString } from "@netlify/database";
import { handle } from "../../lib/api.mjs";

let pool;
export default async (req) => {
  try {
    pool ??= new pg.Pool({ connectionString: getConnectionString(), max: 3 });
    return await handle(req, pool);
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ erro: "Erro interno." }), { status: 500, headers: { "content-type": "application/json" } });
  }
};
export const config = { path: "/api/*" };
