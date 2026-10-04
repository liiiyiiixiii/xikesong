declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    FORECAST_JOB_TOKEN?: string;
    ANALYSIS_API_KEY?: string;
    ANALYSIS_KEY_SECRET?: string;
    ANALYSIS_BASE_URL?: string;
    ANALYSIS_MODEL?: string;
    DEEPSEEK_API_KEY?: string;
    DEEPSEEK_BASE_URL?: string;
    DEEPSEEK_MODEL?: string;
  }
}
