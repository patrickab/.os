/**
 * The commit message of a task's merge commit, without Pi, git or I/O.
 *
 * - A task title that is a conventional commit title is the message as it is. Else the coder is asked once the last
 *   round passed (`COMMIT_MESSAGE_PROMPT`); its answer is checked by `parseCommitMessage`, an invalid one falls back to
 *   the task title (`commitMessageFallback`)
 */

/** A conventional commit title. */
export const COMMIT_TITLE_RE = /^(feat|fix|refactor|perf|docs|test|chore|build|ci|style|revert)(\([^)]+\))?!?: .+/;
/** The longest commit title the coder may answer with. */
export const COMMIT_TITLE_MAX_CHARS = 72;
/** The longest commit body the coder may answer with: it goes to `git commit -m` as one argument. */
export const COMMIT_BODY_MAX_CHARS = 4096;
export const COMMIT_BODY_MAX_LINES = 50;
/** Control characters but the newline (tab included); a NUL cannot even pass as an argument. */
const CONTROL_CHAR_RE = /[\u0000-\u0009\u000b-\u001f\u007f]/;

export interface CommitMessage {
  title: string;
  /** `- ` bullet lines joined by newlines, empty for a title-only message. */
  body: string;
}

export function isConventionalTitle(title: string): boolean {
  return COMMIT_TITLE_RE.test(title);
}

/** The message of a task whose title is used as it is: a conventional title, or the fallback of an invalid answer. */
export function commitMessageFallback(taskTitle: string): CommitMessage {
  return { title: taskTitle, body: "" };
}

/** What the coder is asked for once the last round passed, when the task title is not a conventional commit title. */
export const COMMIT_MESSAGE_PROMPT =
  "The change passed every check. Write its commit message as your whole answer, nothing else, and change no file:\n" +
  `- first line: a conventional commit title (\`type(scope): summary\`, type one of feat, fix, refactor, perf, docs, test, chore, build, ci, style, revert), at most ${COMMIT_TITLE_MAX_CHARS} characters\n` +
  "- then one blank line\n" +
  "- then the body: one `- ` bullet per notable change";

/**
 * The coder's answer as a commit message, or null when it is not one: a title matching `COMMIT_TITLE_RE` of at most
 * `COMMIT_TITLE_MAX_CHARS` characters, a blank line, and one or more lines each starting with `- `, at most
 * `COMMIT_BODY_MAX_LINES` lines and `COMMIT_BODY_MAX_CHARS` characters, no control character but the newline. A
 * surrounding code fence is dropped.
 */
export function parseCommitMessage(answer: string): CommitMessage | null {
  let text = answer.trim();
  const fenced = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(text);
  if (fenced) text = fenced[1].trim();
  const lines = text.split("\n").map((line) => line.trimEnd());
  const [title, blank, ...body] = lines;
  if (title === undefined || title.length > COMMIT_TITLE_MAX_CHARS || !isConventionalTitle(title)) return null;
  if (blank !== "" || body.length === 0 || body.length > COMMIT_BODY_MAX_LINES || !body.every((line) => line.startsWith("- ") && line.length > 2)) return null;
  const message = { title, body: body.join("\n") };
  if (message.body.length > COMMIT_BODY_MAX_CHARS || CONTROL_CHAR_RE.test(message.title) || CONTROL_CHAR_RE.test(message.body)) return null;
  return message;
}

/** The message as `git commit -m` takes it. */
export function commitText(message: CommitMessage): string {
  return message.body === "" ? message.title : `${message.title}\n\n${message.body}`;
}
