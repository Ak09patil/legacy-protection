import type pg from "pg";
/** Applies pending migrations in order, each in its own transaction. Run as the database owner. */
export declare function migrate(client: pg.Client | pg.PoolClient, appRolePassword?: string): Promise<string[]>;
