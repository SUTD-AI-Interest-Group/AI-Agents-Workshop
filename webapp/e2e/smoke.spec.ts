import { spawn, type ChildProcess } from 'node:child_process'
import { expect, test, type Browser, type Page } from '@playwright/test'

const PIN = process.env.BOARD_PIN ?? '123456'
const API = process.env.API_ORIGIN ?? process.env.BASE_URL ?? 'http://localhost:8787'
const run = Date.now().toString(36).slice(-6)
const crewName = `Smoke${run}`
const hello = `hello from alice ${run}`

async function join(browser: Browser, name: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await page.goto('/')
  await page.locator('[data-input-otp]').pressSequentially(PIN)
  await page.locator('#name').fill(name)
  await page.locator('#name').press('Enter')
  await page.waitForFunction(() => Boolean((window as unknown as { editor?: unknown }).editor))
  return page
}

test('two people share a canvas, chat, and a crew answers a mention', async ({ browser }) => {
  const alice = await join(browser, 'Alice')
  const bob = await join(browser, 'Bob')

  // shared drawing
  await alice.evaluate(() => {
    const e = (window as any).editor
    e.createShape({ type: 'geo', x: 200, y: 200, props: { w: 120, h: 80 } })
  })
  await expect.poll(() => bob.evaluate(() => (window as any).editor.getCurrentPageShapes().filter((s: any) => s.type === 'geo').length)).toBeGreaterThan(0)

  // shared chat
  await alice.getByLabel('Message everyone').fill(hello)
  await alice.getByLabel('Message everyone').press('Enter')
  await expect(bob.getByText(hello)).toBeVisible()

  // register a crew and connect a fake listener with its token
  await alice.getByRole('tab', { name: 'Crew' }).click()
  await alice.locator('#crew-name').fill(crewName)
  await alice.getByRole('button', { name: 'Register crew' }).click()
  const token = await alice.locator('dd', { hasText: /^crw_/ }).innerText()
  let crew: ChildProcess | undefined
  try {
    crew = spawn('node', ['e2e/fakeCrew.mjs', API, token, 'pong-reply: '], { stdio: 'inherit' })
    await expect(alice.getByText('Listener connected')).toBeVisible({ timeout: 15_000 })

    await bob.getByLabel('Message everyone').fill(`@${crewName} hello`)
    await bob.getByLabel('Message everyone').press('Enter')
    await expect(bob.getByText(`pong-reply: @${crewName} hello`)).toBeVisible({ timeout: 15_000 })
    await alice.getByRole('tab', { name: 'Chat' }).click()
    await expect(alice.getByText(`pong-reply: @${crewName} hello`)).toBeVisible()
  } finally {
    crew?.kill()
  }
})
