declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    ASSETS?: Fetcher;
    BUCKET?: R2Bucket;
    LOCAL_DEV?: string;
    APP_ORIGIN?: string;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUDIENCE?: string;
    OWNER_EMAIL?: string;
  }
}
