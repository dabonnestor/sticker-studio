import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  clearRecentUploads,
  MAX_RECENT_UPLOADS,
  readRecentUploads,
  RECENT_UPLOADS_KEY,
  recordRecentUpload,
  removeStoredUpload,
  UPLOAD_CHAR_CAP,
} from "@/fabric/recent-uploads"

/**
 * Recent uploads (the sidebar's Uploads panel): the gallery of previously
 * uploaded image files persists as a small deduped list in localStorage,
 * mirroring the working draft's storage conventions. The size guard refuses
 * an over-cap upload (the caller still places it; only the gallery entry is
 * refused), and a quota-refused write drops the oldest entries until it
 * fits — the newest uploads survive, in memory always, in storage when it
 * can hold them.
 */
describe("recent-uploads — the stored gallery", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("records an upload to the documented key and round-trips it", () => {
    const list = recordRecentUpload("data:image/png;base64,AAAA", "logo.png", [])

    expect(list).toEqual([{ name: "logo.png", dataURL: "data:image/png;base64,AAAA" }])
    const stored = JSON.parse(window.localStorage.getItem(RECENT_UPLOADS_KEY)!)
    expect(stored).toEqual(list)
    expect(readRecentUploads()).toEqual(list)
  })

  it("each record lands at the front — the list is newest first", () => {
    const first = recordRecentUpload("data:image/png;base64,AAA", "first.png", [])!
    recordRecentUpload("data:image/png;base64,BBB", "second.png", first)

    const list = readRecentUploads()
    expect(list.map((entry) => entry.name)).toEqual(["second.png", "first.png"])
  })

  it("re-uploading the same bytes moves the tile to the front instead of duplicating it", () => {
    const first = recordRecentUpload("data:image/png;base64,AAA", "first.png", [])!
    const second = recordRecentUpload("data:image/png;base64,BBB", "second.png", first)!
    const list = recordRecentUpload("data:image/png;base64,AAA", "first.png", second)

    expect(list).toEqual([
      { name: "first.png", dataURL: "data:image/png;base64,AAA" },
      { name: "second.png", dataURL: "data:image/png;base64,BBB" },
    ])
    expect(readRecentUploads()).toHaveLength(2)
  })

  it("trims to MAX_RECENT_UPLOADS — the oldest entry drops off the tail", () => {
    const dataURLs = Array.from(
      { length: MAX_RECENT_UPLOADS + 1 },
      (_, i) => `data:image/png;base64,${"A".repeat((i % 3) + 1)}${i}`,
    )
    const first = recordRecentUpload(dataURLs[0]!, `file-${dataURLs[0]!.at(-1)}.png`, [])!
    let current = first
    for (const dataURL of dataURLs.slice(1)) {
      current = recordRecentUpload(dataURL, `file-${dataURL.at(-1)}.png`, current)!
    }

    const list = readRecentUploads()
    expect(list).toHaveLength(MAX_RECENT_UPLOADS)
    // The newest stays, the oldest (the first recorded) is gone.
    expect(list[0]!.dataURL).toBe(dataURLs[dataURLs.length - 1])
    expect(list.some((entry) => entry.dataURL === dataURLs[0])).toBe(false)
  })

  it("an over-cap upload is refused (null) and the stored list is untouched", () => {
    recordRecentUpload("data:image/png;base64,AAA", "first.png", [])
    const refused = recordRecentUpload(
      `data:image/png;base64,${"A".repeat(UPLOAD_CHAR_CAP)}`,
      "huge.png",
      readRecentUploads(),
    )

    expect(refused).toBeNull()
    expect(readRecentUploads()).toEqual([{ name: "first.png", dataURL: "data:image/png;base64,AAA" }])
  })

  it("a corrupt stored value soft-fails: the key is wiped and the read returns empty", () => {
    window.localStorage.setItem(RECENT_UPLOADS_KEY, "NOT A LIST")

    expect(readRecentUploads()).toEqual([])
    expect(window.localStorage.getItem(RECENT_UPLOADS_KEY)).toBeNull()
  })

  it("a quota-refused write drops the oldest entries until storage accepts it", () => {
    const setItem = window.localStorage.setItem
    const original = setItem.bind(window.localStorage)
    // Storage accepts only a one-entry list — the quota simulation is
    // semantic (parsed entries), not a character length to guess.
    vi.spyOn(window.localStorage, "setItem").mockImplementation((key, value) => {
      if (value && (JSON.parse(value) as unknown[]).length > 1) {
        throw new Error("quota exceeded")
      }
      original(key, value)
    })
    let current = recordRecentUpload("data:image/png;base64,AA", "first.png", [])!

    // The merge runs against the caller's list, not storage — so the newest
    // upload and the previous one are both present in the returned truth,
    // while storage keeps the newest prefix that actually fit.
    current = recordRecentUpload("data:image/png;base64,BBBB", "second.png", current)!
    expect(current).toEqual([
      { name: "second.png", dataURL: "data:image/png;base64,BBBB" },
      { name: "first.png", dataURL: "data:image/png;base64,AA" },
    ])
    expect(readRecentUploads()).toEqual([
      { name: "second.png", dataURL: "data:image/png;base64,BBBB" },
    ])
  })

  it("a still-refused write gives up on storage but keeps the session's list in memory", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded")
    })
    const first = recordRecentUpload("data:image/png;base64,AAA", "first.png", [])!

    const list = recordRecentUpload("data:image/png;base64,BBBB", "second.png", first)

    // The merge base is the caller's in-memory list — the pre-refusal upload
    // survives even though storage never accepted it.
    expect(list).toEqual([
      { name: "second.png", dataURL: "data:image/png;base64,BBBB" },
      { name: "first.png", dataURL: "data:image/png;base64,AAA" },
    ])
    // Storage holds nothing — only a refresh reveals the drop.
    expect(window.localStorage.getItem(RECENT_UPLOADS_KEY)).toBeNull()
  })

  it("removeStoredUpload drops the entry from the list and storage", () => {
    const first = recordRecentUpload("data:image/png;base64,AAA", "first.png", [])!
    const second = recordRecentUpload("data:image/png;base64,BBBB", "second.png", first)!

    const list = removeStoredUpload("data:image/png;base64,AAA", second)

    expect(list).toEqual([{ name: "second.png", dataURL: "data:image/png;base64,BBBB" }])
    expect(readRecentUploads()).toEqual(list)
  })

  it("removing an entry that isn't in the gallery is a no-op", () => {
    const first = recordRecentUpload("data:image/png;base64,AAA", "first.png", [])!

    const list = removeStoredUpload("data:image/png;base64,ZZZ", first)

    expect(list).toEqual(first)
    expect(readRecentUploads()).toEqual(first)
  })

  it("removing the last upload clears the key entirely", () => {
    const first = recordRecentUpload("data:image/png;base64,AAA", "first.png", [])!

    const list = removeStoredUpload("data:image/png;base64,AAA", first)

    expect(list).toEqual([])
    expect(window.localStorage.getItem(RECENT_UPLOADS_KEY)).toBeNull()
    expect(readRecentUploads()).toEqual([])
  })

  it("clearRecentUploads empties the store", () => {
    recordRecentUpload("data:image/png;base64,AAA", "first.png", [])
    clearRecentUploads()

    expect(window.localStorage.getItem(RECENT_UPLOADS_KEY)).toBeNull()
    expect(readRecentUploads()).toEqual([])
  })
})
