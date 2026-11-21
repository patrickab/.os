/**
 * Video paste: a video in a prompt reaches the model as up to 8 readable frames picked at scene changes, plus a
 * metadata line. Two triggers:
 *
 * - gigachad-bot's composer: an `@…/pastes/<file>` mention (it stores pasted videos in `<cwd>/.pi/pastes/`)
 * - terminal Pi: a video chip of `chips.ts`, which sends the absolute path as `<paste>…</paste>`
 *
 * Contract with gigachad-bot (`src/frontend/features/pi/VideoPreview.tsx`): the `video-preview` custom message.
 *
 * - `input` probes the video (`ffprobe`), scores every frame's change from the one before (`ffmpeg` scene score on a
 *   downscaled copy), picks the frame times (`pickFrameTimes`) and extracts them as JPEGs at most 1280 px wide
 * - Deterministic: the same file and ffmpeg version give the same frames
 * - An idle prompt also gets one `video-preview` custom message (`details.videos`: metadata and frames per video) right after it, injected
 *   from `before_agent_start`, so it joins the prompt's run and starts no extra turn
 * - A prompt sent while a run streams (steer, follow-up) is only transformed: a queued custom message would cost an extra model call
 * - ffmpeg and ffprobe come from PATH, a failing video is reported with `notify` and its mention left as typed
 */
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

const VIDEO = "mp4|webm|mov|mkv|avi|m4v"
/** Group 1 is a gigachad-bot paste mention, group 2 a chip's absolute path. */
const MENTION = new RegExp(`@(\\S*\\/pastes\\/\\S+\\.(?:${VIDEO}))(?=\\s|$)|<paste>(\\/[^<\\r\\n]+\\.(?:${VIDEO}))<\\/paste>`, "gi")
const MAX_FRAMES = 8
/** Scene changes among the frames, the rest fill the largest gaps in time. */
const MAX_SCENE_FRAMES = 4
/** Below this the change is cursor movement or encoder noise (measured below 0.001), text appearing scores about 0.004. */
const MIN_SCENE_SCORE = 0.002
/** A frame counts as settled once the screen stayed below `MIN_SCENE_SCORE` this long, e.g. a page finished loading. */
const STILL_SECONDS = 0.5
/** Give up waiting for a still screen after this long and take the frame where the search started. */
const MAX_SETTLE_SECONDS = 3
const FRAME_WIDTH = 1280
const SCORE_WIDTH = 320
const TOOL_TIMEOUT_MS = 120_000

interface VideoMetadata {
  durationSeconds: number | null
  width: number | null
  height: number | null
  fps: number | null
}

export interface VideoFrame {
  seconds: number
  image: { data: string; mimeType: "image/jpeg" }
}

export interface VideoPreviewDetails extends VideoMetadata {
  path: string
  frames: VideoFrame[]
}

/** `details` of a `video-preview` custom message: one entry per video of the prompt. */
export interface VideoPreviewMessageDetails {
  videos: VideoPreviewDetails[]
}

/** How much a frame differs from the one before it, ffmpeg's scene score from 0 to 1. */
export interface SceneScore {
  seconds: number
  score: number
}

interface ProbeOutput {
  format?: { duration?: string }
  streams?: { width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string }[]
}

function frameRate(rate: string | undefined): number | null {
  const [numerator, denominator] = (rate ?? "").split("/").map(Number)
  const fps = denominator ? numerator / denominator : numerator
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 100) / 100 : null
}

/** `83.4` as `1:23.4`. */
export function clockTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, "0")}`
}

/** One line the model reads next to the frames. */
export function metadataLine({ path, durationSeconds, width, height, fps, frames }: VideoPreviewDetails): string {
  const facts = [
    durationSeconds === null ? null : `${durationSeconds.toFixed(1)} s`,
    width && height ? `${width}x${height}` : null,
    fps === null ? null : `${fps} fps`,
  ].filter(Boolean)
  const times = frames.map(({ seconds }) => clockTime(seconds)).join(", ")
  return `[Video ${path}: ${facts.join(", ")}. Attached in this order: ${frames.length} frames at ${times}, taken after scene changes and in between]`
}

/** The video mentions in `text`, each once, in order. */
export function videoMentions(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION)].map((match) => match[1] ?? match[2]))]
}

/** `metadata=print` output as one score per frame, in time order. */
export function parseSceneScores(output: string): SceneScore[] {
  const scores: SceneScore[] = []
  let seconds: number | null = null
  for (const line of output.split("\n")) {
    const time = /pts_time:([\d.]+)/.exec(line)
    if (time) seconds = Number(time[1])
    const score = /scene_score=([\d.]+)/.exec(line)
    if (score && seconds !== null) scores.push({ seconds, score: Number(score[1]) })
  }
  return scores
}

/** The time from `scores[start]` on when the screen has stood still for `STILL_SECONDS`, else `scores[start]`'s. */
export function settledTime(scores: SceneScore[], start: number): number {
  const from = scores[start].seconds
  let stillSince = from
  for (const { seconds, score } of scores.slice(start + 1)) {
    if (seconds - from > MAX_SETTLE_SECONDS) break
    if (score >= MIN_SCENE_SCORE) stillSince = seconds
    else if (seconds - stillSince >= STILL_SECONDS) return seconds
  }
  return from
}

/**
 * Frame times, sorted: the first and last frame, the strongest scene changes, then the largest gaps' midpoints, each
 * moved to where the screen settled (`settledTime`). Frames keep `minGap` apart, so one transition yields one frame.
 */
export function pickFrameTimes(scores: SceneScore[]): number[] {
  const end = scores.at(-1)?.seconds ?? 0
  const minGap = end / (MAX_FRAMES * 2)
  const picks = end > 0 ? [0, end] : [0]
  const isFree = (seconds: number) => picks.every((pick) => Math.abs(pick - seconds) >= minGap)

  const changes = scores
    .map((score, index) => ({ ...score, index }))
    .filter(({ score }) => score >= MIN_SCENE_SCORE)
    .sort((a, b) => b.score - a.score || a.seconds - b.seconds)
  let sceneFrames = 0
  for (const { index } of changes) {
    if (sceneFrames === MAX_SCENE_FRAMES || picks.length === MAX_FRAMES) break
    const settled = settledTime(scores, index)
    if (!isFree(settled)) continue
    picks.push(settled)
    sceneFrames++
  }

  while (picks.length < MAX_FRAMES) {
    picks.sort((a, b) => a - b)
    const gaps = picks.slice(1).map((seconds, index) => ({ from: picks[index], length: seconds - picks[index] }))
    const widest = gaps.reduce((best, gap) => (gap.length > best.length ? gap : best), { from: 0, length: 0 })
    if (widest.length < 2 * minGap) break
    const midpoint = widest.from + widest.length / 2
    const settled = settledTime(scores, scores.findIndex(({ seconds }) => seconds >= midpoint))
    // The midpoint always splits the gap, a settled time near another frame would not
    picks.push(isFree(settled) ? settled : midpoint)
  }
  return picks.sort((a, b) => a - b)
}

export default function (pi: ExtensionAPI) {
  let pending: VideoPreviewDetails[] = []

  async function run(command: string, args: string[]): Promise<string> {
    const result = await pi.exec(command, args, { timeout: TOOL_TIMEOUT_MS })
    if (result.code !== 0) throw new Error(result.stderr.trim() || `${command} exited with ${result.code}`)
    return result.stdout
  }

  async function probe(file: string): Promise<VideoMetadata> {
    const args = ["-v", "error", "-select_streams", "v:0", "-show_entries", "format=duration:stream=width,height,avg_frame_rate,r_frame_rate", "-of", "json", file]
    const output = JSON.parse(await run("ffprobe", args)) as ProbeOutput
    const stream = output.streams?.[0]
    if (!stream) throw new Error("no video stream")
    const duration = Number(output.format?.duration)
    return {
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
      width: stream.width ?? null,
      height: stream.height ?? null,
      fps: frameRate(stream.avg_frame_rate) ?? frameRate(stream.r_frame_rate),
    }
  }

  async function frames(file: string, folder: string): Promise<VideoFrame[]> {
    const scoresFile = join(folder, "scores.txt")
    const scoring = `scale=${SCORE_WIDTH}:-2,select='gte(scene,0)',metadata=print:file=${scoresFile}`
    await run("ffmpeg", ["-v", "error", "-i", file, "-an", "-vf", scoring, "-f", "null", "-"])
    const scores = parseSceneScores(await readFile(scoresFile, "utf8"))
    // Every frame got a score, so a score's index is its frame number: the first frame at or after each picked time
    const numbers = [...new Set(pickFrameTimes(scores).map((seconds) => scores.findIndex((score) => score.seconds >= seconds)))]
    // One more decoding pass keeps exactly those frames. JPEG needs full-range color, most video is limited range
    const keep = numbers.map((number) => `eq(n,${number})`).join("+")
    const extraction = `select='${keep}',scale='min(${FRAME_WIDTH},iw)':-2:out_range=full,format=yuvj420p`
    await run("ffmpeg", ["-v", "error", "-i", file, "-an", "-vf", extraction, "-fps_mode", "passthrough", "-q:v", "3", join(folder, "frame-%d.jpg")])
    return Promise.all(
      numbers.map(async (number, index) => ({
        seconds: scores[number].seconds,
        image: { data: (await readFile(join(folder, `frame-${index + 1}.jpg`))).toString("base64"), mimeType: "image/jpeg" as const },
      })),
    )
  }

  async function preview(path: string, cwd: string): Promise<VideoPreviewDetails> {
    const file = resolve(cwd, path)
    const metadata = await probe(file)
    const folder = await mkdtemp(join(tmpdir(), "pi-video-paste-"))
    try {
      return { path, ...metadata, frames: await frames(file, folder) }
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }

  pi.on("input", async (event, ctx) => {
    const mentions = videoMentions(event.text)
    if (mentions.length === 0) return { action: "continue" }
    const previews: VideoPreviewDetails[] = []
    for (const path of mentions) {
      try {
        previews.push(await preview(path, ctx.cwd))
      } catch (error) {
        ctx.ui.notify(`Video preview of ${path} failed: ${error instanceof Error ? error.message : String(error)}`, "warning")
      }
    }
    if (previews.length === 0) return { action: "continue" }
    pending = event.streamingBehavior ? [] : previews
    const lines = previews.map(metadataLine)
    const images = previews.flatMap(({ frames }) => frames.map(({ image }) => ({ type: "image" as const, ...image })))
    return { action: "transform", text: `${event.text}\n\n${lines.join("\n")}`, images: [...(event.images ?? []), ...images] }
  })

  pi.on("before_agent_start", async (event) => {
    // Only the run of the prompt the previews were made for: a prompt another extension handled leaves them behind
    const videos = pending.filter(({ path }) => event.messageType === "user" && event.prompt.includes(path))
    pending = []
    if (videos.length === 0) return
    const details: VideoPreviewMessageDetails = { videos }
    return { message: { customType: "video-preview", content: `Video preview: ${videos.map(({ path }) => path).join(", ")}`, display: true, details } }
  })
}
