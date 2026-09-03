---
name: gitlab
description: "Interact with GitLab via authenticated glab: issues, comments, merge requests, pipelines, uploads, and REST API resources."
---

# GitLab

Use authenticated `glab` only. Do not use `curl` or manually extract tokens.

Before posting or modifying issues/comments, draft the text for the user and wait for confirmation.

Writing style:
- no unnecessary detail
- logical sequential structure
- concise, informative, skimmable, bring the core intent to the point.
- lots of text and lots of technical details cause cognitive overload. Avoid that.
- include names/commands only when useful - technical details earn their place when they significantly improve the reader's understanding or ability to act.

Check access with a real API call:

```bash
glab api user
```

Use `-R <namespace>/<project>` outside the repo. Inside the repo, prefer `glab api` placeholders like `:id`. For reads, request only needed fields with `--jq`; never load unfiltered JSON when a concise selection is sufficient.

## Issues

Read:

```bash
glab issue view <iid> -R <namespace>/<project>
glab issue view <iid> --comments -R <namespace>/<project>
glab issue list -R <namespace>/<project>
glab api "projects/:id/issues/<iid>" --jq '{title,description,state,labels,web_url}'
```

Full issue URLs are accepted by `glab issue view`.

For `/-/work_items/<iid>` issue links, first try:

```bash
glab issue view <iid> -R <namespace>/<project>
```

Create/update:

```bash
glab issue create -R <namespace>/<project>
glab issue update <iid> -R <namespace>/<project> --title "<title>"
glab issue update <iid> -R <namespace>/<project> --description-file /path/to/body.md
```

## Comments / notes

Post short issue comment:

```bash
glab issue note <iid> -R <namespace>/<project> --message "<comment>"
```

Post multiline Markdown from file:

```bash
glab api -X POST "projects/:id/issues/<iid>/notes" \
  -F "body=@/path/to/comment.md"
```

Edit a note in place:

```bash
glab api -X PUT "projects/:id/issues/<iid>/notes/<note_id>" \
  -F "body=@/path/to/comment.md"
```

Prefer editing the existing note when revising the same comment.

## Merge requests

```bash
glab mr view <iid> -R <namespace>/<project>
glab mr view <iid> --comments -R <namespace>/<project>
glab mr list -R <namespace>/<project>
glab mr diff <iid> -R <namespace>/<project>
glab mr checkout <iid> -R <namespace>/<project>
glab api "projects/:id/merge_requests/<iid>" --jq '{title,description,state,source_branch,target_branch,web_url}'
```

## Pipelines

Run full pipeline:

```bash
glab ci run
```

Run selected jobs:

```bash
glab ci run --variables 'JOBS_TO_RUN:lint&unit'
```

Inspect pipelines/jobs:

```bash
glab pipeline list
glab pipeline view <pipeline_id>
glab ci view <pipeline_id>
glab api "projects/:id/pipelines/<pipeline_id>/jobs" --jq '.[] | {id,name,status,web_url}'
```

Trigger MR pipeline:

```bash
glab api -X POST "projects/:id/merge_requests/<iid>/pipelines"
```

Play a manual job:

```bash
glab api -X POST "projects/:id/jobs/<job_id>/play"
```

## Uploads and images

Upload image/file:

```bash
glab api -X POST "projects/:id/uploads" \
  --form "file=@/path/to/image.png"
```

Get embeddable Markdown:

```bash
glab api -X POST "projects/:id/uploads" \
  --form "file=@/path/to/image.png" \
  --jq '.markdown'
```

Use returned Markdown directly:

```md
![alt](/uploads/<hash>/<filename>.png)
```

For constant display size:

```html
<img src="/uploads/<hash>/<filename>.png" alt="alt" width="650">
```

Do not re-upload only to resize.

## Notes

- Use `glab api` for REST operations without a dedicated subcommand.
- `-F "field=@file"` reads file contents into an API field.
- `--form "file=@path"` uploads a file as multipart form data.
- If auth fails, ask the user to run `glab auth login`.
