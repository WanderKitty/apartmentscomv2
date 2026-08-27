import { describe, it, expect } from 'vitest'

describe('workspace smoke', () => {
  it('runs tests with env loading in place', () => {
    expect(1 + 1).toBe(2)
  })
})
