import { DurableObject } from 'cloudflare:workers'
import type { Env } from './index'

export class BoardRoom extends DurableObject<Env> {}
