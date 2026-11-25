import { describe, expect, test } from 'bun:test'
import { toAuthStatus } from '../src/agent'
import { readInstalledSdk, render } from '../scripts/gen-sdk-version'

describe('toAuthStatus', () => {
  test('subscription login (apiKeySource is "none" in this case)', () => {
    expect(toAuthStatus({ email: 'a@b.c', subscriptionType: 'Claude Pro', apiProvider: 'firstParty', apiKeySource: 'none' })).toEqual({
      state: 'subscription',
      plan: 'Claude Pro',
    })
  })
  test('API key from the environment', () => {
    expect(toAuthStatus({ apiKeySource: 'ANTHROPIC_API_KEY', apiProvider: 'firstParty' })).toEqual({ state: 'apiKey', source: 'ANTHROPIC_API_KEY' })
  })
  test('signed out', () => {
    expect(toAuthStatus({ tokenSource: 'none', apiProvider: 'firstParty' })).toEqual({ state: 'signedOut' })
  })
  test('third-party provider', () => {
    expect(toAuthStatus({ apiProvider: 'bedrock' })).toEqual({ state: 'apiKey', source: 'bedrock' })
  })
})

test('sdkVersion.generated.ts matches the installed SDK (run `bun run gen` after upgrading)', async () => {
  const onDisk = await Bun.file(new URL('../src/sdkVersion.generated.ts', import.meta.url)).text()
  expect(onDisk).toBe(render(await readInstalledSdk()))
})
