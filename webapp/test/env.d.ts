declare namespace Cloudflare {
  interface Env {
    BOARD_ROOM: DurableObjectNamespace<import('../worker/BoardRoom').BoardRoom>
    ASSETS: Fetcher
    BOARD_PIN: string
    SESSION_SECRET: string
  }
}
