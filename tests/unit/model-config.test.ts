import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ModelResolver } from "opencode-model-resolver"
import { afterEach, beforeEach, vi } from "vitest"

describe("model resolver", () => {
  let cacheDir: string
  const catalog = {
    "github-copilot": {
      models: {
        "claude-opus-4.1": { id: "claude-opus-4.1", family: "claude-opus", release_date: "2026-03-01" },
        "claude-opus-4.0": { id: "claude-opus-4.0", family: "claude-opus", release_date: "2026-01-01" },
        "claude-sonnet-4.0": { id: "claude-sonnet-4.0", family: "claude-sonnet", release_date: "2026-02-01" },
        "claude-sonnet-3.7": { id: "claude-sonnet-3.7", family: "claude-sonnet", release_date: "2025-11-01" },
        "gpt-4o": { id: "gpt-4o", family: "gpt", release_date: "2025-12-01" },
      },
    },
  }

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "corina-model-cache-"))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(cacheDir, { recursive: true, force: true })
  })

  it("resolves the newest claude-opus model for the writing-quality preset", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK", json: async () => catalog })
    vi.stubGlobal("fetch", fetchMock)

    const resolver = new ModelResolver({ cachePath: join(cacheDir, "models.json") })
    const result = await resolver.resolveStepModel({ preset: "writing-quality" }, "github-copilot")

    expect(result).toEqual({ providerID: "github-copilot", modelID: "claude-opus-4.1" })
  })

  it("resolves the newest model in a requested family", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK", json: async () => catalog }),
    )

    const resolver = new ModelResolver({ cachePath: join(cacheDir, "models.json") })
    const result = await resolver.resolveStepModel({ family: "claude-sonnet" }, "github-copilot")

    expect(result.modelID).toBe("claude-sonnet-4.0")
  })

  it("returns an exact model id when one is requested", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const resolver = new ModelResolver({ cachePath: join(cacheDir, "models.json") })
    const result = await resolver.resolveStepModel({ modelID: "gpt-4o" }, "github-copilot")

    expect(result).toEqual({ providerID: "github-copilot", modelID: "gpt-4o" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("uses the in-memory cache on repeated lookups", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK", json: async () => catalog })
    vi.stubGlobal("fetch", fetchMock)

    const resolver = new ModelResolver({ cachePath: join(cacheDir, "models.json") })

    await resolver.resolveStepModel({ preset: "writing-quality" }, "github-copilot")
    await resolver.resolveStepModel({ family: "claude-sonnet" }, "github-copilot")

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
