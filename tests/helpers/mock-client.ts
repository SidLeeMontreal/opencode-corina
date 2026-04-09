export interface MockSessionRecord {
  title: string
  prompts: Array<Record<string, unknown>>
  deleted: boolean
}

export function createMockClient(responses: unknown[] = []) {
  const sessions = new Map<string, MockSessionRecord>()
  let counter = 0

  return {
    sessions,
    session: {
      async create({ body }: { body: { title?: string } }) {
        const id = `mock-session-${++counter}`
        sessions.set(id, { title: body.title ?? "", prompts: [], deleted: false })
        return { data: { id } }
      },
      async prompt({ path, body }: { path: { id?: string; sessionID?: string }; body: Record<string, unknown> }) {
        const id = path.id ?? path.sessionID
        if (!id || !sessions.has(id)) {
          throw new Error(`Unknown mock session: ${id ?? "missing"}`)
        }

        sessions.get(id)!.prompts.push(body)
        const next = responses.shift()
        return next ?? { data: { parts: [{ type: "text", text: "## FINAL\nMock response" }] } }
      },
      async delete({ path }: { path: { id?: string; sessionID?: string } }) {
        const id = path.id ?? path.sessionID
        if (id && sessions.has(id)) {
          sessions.get(id)!.deleted = true
        }
        return { data: { ok: true } }
      },
    },
  }
}
