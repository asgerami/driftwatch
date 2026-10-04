/** A text replacement in one file, by character offsets into the original. */
export interface Edit {
  start: number;
  end: number;
  text: string;
}

function sorted(edits: Edit[]): Edit[] {
  const list = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < list.length; i++) {
    if (list[i]!.start < list[i - 1]!.end) throw new Error("overlapping edits");
  }
  return list;
}

export function applyEdits(text: string, edits: Edit[]): string {
  let out = "";
  let at = 0;
  for (const edit of sorted(edits)) {
    out += text.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  return out + text.slice(at);
}

/** Line index (0-based) of each offset, by the starts of lines. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * A unified diff (`git apply` reads it) built from the edits themselves, so
 * hunks are exactly the lines the edits touch, with three lines of context.
 */
export function unifiedDiff(file: string, text: string, edits: Edit[], context = 3): string {
  if (edits.length === 0) return "";
  const starts = lineStarts(text);
  const lines = text.split("\n");
  const endsWithNewline = text.endsWith("\n");
  if (endsWithNewline) lines.pop();

  // Edits that share a line form a cluster; clusters close enough that
  // their context would touch form one hunk.
  interface Cluster {
    first: number;
    last: number;
    edits: Edit[];
  }
  const clusters: Cluster[] = [];
  for (const edit of sorted(edits)) {
    const first = lineOf(starts, edit.start);
    // An edit that takes a newline with it reaches into the next line.
    const reach = edit.end > edit.start && text[edit.end - 1] === "\n" ? edit.end : Math.max(edit.start, edit.end - 1);
    const last = Math.min(lines.length - 1, Math.max(first, lineOf(starts, reach)));
    const previous = clusters[clusters.length - 1];
    if (previous && first <= previous.last) {
      previous.last = Math.max(previous.last, last);
      previous.edits.push(edit);
    } else {
      clusters.push({ first, last, edits: [edit] });
    }
  }
  const hunks: Cluster[][] = [];
  for (const c of clusters) {
    const hunk = hunks[hunks.length - 1];
    if (hunk && c.first - hunk[hunk.length - 1]!.last - 1 <= 2 * context) hunk.push(c);
    else hunks.push([c]);
  }

  const out = [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`];
  let delta = 0;
  for (const hunk of hunks) {
    const first = hunk[0]!.first;
    const last = hunk[hunk.length - 1]!.last;
    const body: string[] = [];
    let oldCount = 0;
    let newCount = 0;
    const keep = (l: string) => {
      body.push(` ${l}`);
      oldCount++;
      newCount++;
    };
    const before = lines.slice(Math.max(0, first - context), first);
    before.forEach(keep);
    let at = first;
    for (const c of hunk) {
      lines.slice(at, c.first).forEach(keep);
      const from = starts[c.first]!;
      const to = c.last + 1 < starts.length ? starts[c.last + 1]! - 1 : text.length - (endsWithNewline ? 1 : 0);
      const shifted = c.edits.map((e) => ({ start: e.start - from, end: e.end - from, text: e.text }));
      let oldLines = lines.slice(c.first, c.last + 1);
      let newLines = applyEdits(text.slice(from, to), shifted).split("\n");
      // Lines an insertion or deletion leaves as they were are context.
      const lead: string[] = [];
      while (oldLines.length > 0 && newLines.length > 0 && oldLines[0] === newLines[0]) {
        lead.push(oldLines[0]!);
        oldLines = oldLines.slice(1);
        newLines = newLines.slice(1);
      }
      const tail: string[] = [];
      while (oldLines.length > 0 && newLines.length > 0 && oldLines[oldLines.length - 1] === newLines[newLines.length - 1]) {
        tail.unshift(oldLines[oldLines.length - 1]!);
        oldLines = oldLines.slice(0, -1);
        newLines = newLines.slice(0, -1);
      }
      lead.forEach(keep);
      for (const l of oldLines) body.push(`-${l}`);
      for (const l of newLines) body.push(`+${l}`);
      oldCount += oldLines.length;
      newCount += newLines.length;
      tail.forEach(keep);
      at = c.last + 1;
    }
    lines.slice(last + 1, Math.min(lines.length, last + 1 + context)).forEach(keep);
    const oldStart = first - before.length + 1;
    out.push(`@@ -${oldStart},${oldCount} +${oldStart + delta},${newCount} @@`, ...body);
    delta += newCount - oldCount;
  }
  return `${out.join("\n")}\n`;
}
