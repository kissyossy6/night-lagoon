import type { ShowVariant } from '../show/choreography';
import type { ShowFile } from '../show/types';

/**
 * One project: a show and what the list says about it (docs/projects-plan.md).
 * Saved as projects/<id>/project.json by the dev server (scripts/project-store.ts),
 * or in the browser when there is no dev server (src/projects/store.ts).
 */
export interface ProjectDoc {
  format: 1;
  /** The folder's name. Samples start with "sample-". */
  id: string;
  name: string;
  /** ISO dates. */
  created: string;
  updated: string;
  /** The show. null until it is first made (see `generate`). */
  show: ShowFile | null;
  /**
   * While `show` is null: which built-in version to generate (it follows the
   * music's waveform once that is analysed, src/show/choreography.ts), or an
   * empty show.
   */
  generate?: ShowVariant | 'empty';
  /** The sample this project was made from. */
  from?: string;
  /** Samples only: true, and one line for the list. */
  sample?: boolean;
  description?: string;
}

/** What the list shows of a project (no cues). */
export interface ProjectSummary {
  id: string;
  name: string;
  created: string;
  updated: string;
  from?: string;
  generate?: ProjectDoc['generate'];
  venue?: string;
  duration?: number;
  cues?: number;
  /** Picture URL, if one was taken. */
  thumb?: string;
  sample?: boolean;
  description?: string;
}
