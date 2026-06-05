declare module "sql.js" {
  interface BindParams {
    [key: string]: any;
  }

  interface QueryExecResult {
    columns: string[];
    values: any[][];
  }

  interface Statement {
    bind(params?: any[] | BindParams): boolean;
    step(): boolean;
    getAsObject(): Record<string, any>;
    free(): boolean;
    run(params?: any[] | BindParams): void;
  }

  interface Database {
    run(sql: string, params?: any[] | BindParams): void;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }

  export default function initSqlJs(config?: any): Promise<SqlJsStatic>;
  export type { Database, Statement, BindParams, QueryExecResult, SqlJsStatic };
}
