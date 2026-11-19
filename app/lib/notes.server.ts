import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "~/db/schema";
import { courses, lessons, modules, notes } from "~/db/schema";
import { MAX_NOTE_LENGTH } from "~/lib/notes";
import { savedLessonColumns } from "~/lib/saved-lesson.server";

// ─── Notes ───
// A Student's own writing about a Lesson, private to the Student who wrote it.
// One per Student per Lesson, enforced by a unique index. A Note body is plain
// text and is never rendered as Markdown. See GLOSSARY.md for the language.
//
// Nothing outside the owning Student's Lesson page and Saved page may read a
// Note body: no Instructor or Platform Admin view.
//
// These functions do not check content access: the calling action must run
// requireContentAccess first. Every function takes the database first, so
// tests can hand in an in-memory one. Uses positional parameters (project
// convention).

export type Db = BetterSQLite3Database<typeof schema>;

/**
 * A Note body: plain text, trimmed, never empty, capped on write. The route
 * parses form data with it and saveNote re-checks with it, so both refuse with
 * the same message.
 */
export const noteBodySchema = z
  .string()
  .trim()
  .min(1, "Write something before saving your note.")
  .max(
    MAX_NOTE_LENGTH,
    `Your note is over ${MAX_NOTE_LENGTH.toLocaleString("en")} characters, so it was not saved.`
  );

export type NoteView = { body: string; updatedAt: string };

/** The Student's Note on the Lesson, if they have written one. */
export function getNote(
  db: Db,
  studentId: number,
  lessonId: number
): NoteView | null {
  return (
    db
      .select({ body: notes.body, updatedAt: notes.updatedAt })
      .from(notes)
      .where(and(eq(notes.userId, studentId), eq(notes.lessonId, lessonId)))
      .get() ?? null
  );
}

export type SaveNoteResult =
  { ok: true; note: NoteView } | { ok: false; error: string };

/**
 * Writes the Student's Note on the Lesson. Saving again replaces the body and
 * moves `updatedAt` on; `createdAt` stays where it was. An empty or over-long
 * body is refused rather than truncated.
 */
export function saveNote(
  db: Db,
  studentId: number,
  lessonId: number,
  body: string,
  now: Date
): SaveNoteResult {
  const parsed = noteBodySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const at = now.toISOString();
  const note = db
    .insert(notes)
    .values({
      userId: studentId,
      lessonId,
      body: parsed.data,
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body: parsed.data, updatedAt: at },
    })
    .returning({ body: notes.body, updatedAt: notes.updatedAt })
    .get();

  return { ok: true, note };
}

/** The Student's Notes, most recently edited first, each with its Lesson and Course. */
export function listNotes(db: Db, studentId: number) {
  return db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      lesson: savedLessonColumns,
    })
    .from(notes)
    .innerJoin(lessons, eq(lessons.id, notes.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(eq(notes.userId, studentId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();
}
